var getMime = require('simple-mime')("application/octet-stream");
var FTP = require("jsftp");
var Crypto = require("crypto");

function once(fn) {
    var done = false;
    return function () {
        if (done) {
            console.warn("Attempt to call callback more than once " + fn);
            return;
        }
        done = true;
        return fn.apply(this, arguments);
    };
}

function calcEtag(path, size) {
    return Crypto.createHash('md5').update("" + path + size).digest("hex");
}

// fsOptions.credentials - object containing port, host, user and password. All
// the properties are strings except for port, which is a number.
module.exports = function setup(fsOptions) {
    var ftpClient = new FTP(fsOptions.credentials);

    return {
        readfile: readfile,
        mkfile: mkfile,
        rmfile: rmfile,
        //readdir: readdir,
        stat: stat,
        mkdir: mkdir,
        rmdir: rmdir,
        rename: rename,
        copy: copy,
        symlink: symlink,
        //resetCache: resetCache
    };

    function readfile(path, options, callback) {
        callback = once(callback);

        ftpClient.ls(path, function(err, result) {
            if (err || !result || result.length === 0)
                return callback("The file " + path + " could not be retrieved.");

            var stat = result[0]; // File information already parsed
            var meta = {
                mime: getMime(path),
                size: parseInt(stat.size, 10),
                etag: calcEtag(path + stat.size)
            };

            // ETag support
            if (options.etag === meta.etag) {
                meta.notModified = true;
                return callback(null, meta);
            }

            ftpClient.getSocket(path, function(err, socket) {
                if (err) return callback(err);

                meta.stream = socket;
                callback(null, meta);
            });
        });
    }

    function mkfile(path, options, callback) {
        callback = once(callback);

        if (!options.stream) {
            return callback(new Error("stream is an required option"));
        }

        // Pause the input for now since we're not ready to write quite yet
        var readable = options.stream;
        if (readable.pause)
            readable.pause();

        function error(err) {
            readable.removeListener("end", callback);

            if (readable.destroy)
                readable.destroy();

            if (err)
                callback(err);
        }

        //this pipes readable with pasv socket
        ftpClient.getPutSocket(path, readable, function(err, socket) {
            if (err) return error(err);

            if (socket && socket.writable) {
                readable.on("end", callback);
                readable.on("error", error);
                readable.pipe(socket);

                if (readable.resume)
                    readable.resume();
            }
            else {
                callback(new Error("Could not retrieve a passive connection for " +
                                   "command 'stor'" + path + "'."));
            }
        });
    }

    function rmfile(path, options, callback) {
        ftpClient.raw.dele(path, callback);
    }

    function stat(path, options, callback) {
        ftpClient.ls(path, function(err, result) {
            if (err || !result || result.length === 0)
                return callback(new Error("The file " + path + " could not be retrieved."));

            var stat = result[0]; // File information already parsed
            var meta = {
                mime: getMime(path),
                size: parseInt(stat.size, 10),
                etag: calcEtag(path + stat.size),
                name: stat.name,
                path: path
            };

            callback(null, meta);
        });
    }

    function mkdir(path, options, callback) {
        ftpClient.raw.mkd(path, function(err) { callback(err, {}); });
    }

    function rmdir(path, options, callback) {
        ftpClient.raw.rmd(path, function (err) {
          if (err)
              return callback(err);

          return callback(null, {});
        });
    }

    function rename(path, options, callback) {
        ftpClient.rename(options.from, path, function(err) {
            callback(err, {});
        });
    }

    function copy(path, options, callback) {
        callback = once(callback);
        if (!options || !options.from)
            callback(new Error("copy: No 'from' field in options."));

        ftpClient.getGetSocket(options.from, function(err, readable) {
            if (err) callback(err);
            if (readable.pause)
                readable.pause();

            readable.on("error", callback);

            function error(err) {
                readable.removeListener("error", callback);

                if (readable.destroy)
                    readable.destroy();

                if (err)
                    callback(err);
            }

            ftpClient.getPutSocket(path, function(err, writer) {
                if (err) callback(err);

                readable.pipe(writer);
                writer.on("close", function() { callback(null, {}); });
                writer.on("error", error);
            });
        });
    }

    function symlink(path, options, callback) {
        callback(new Error("symlink: Not Implemented"));
    }
};
