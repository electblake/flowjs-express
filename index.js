// # flowjs express
var fs = require('fs-extra'),
    path = require('path');

module.exports = flow = function(temporaryFolder) {
    var $ = this;
    $.temporaryFolder = temporaryFolder;
    $.maxFileSize = null;
    $.fileParameterName = 'file';
    
    // Ensure that the temporary folder exists
    fs.ensureDir($.temporaryFolder);

    /**
     * GET flow middleware
     * req.flow.status
     *  * found
     *  * not_found
     */
    $.get = function(req, res, next) {
        var chunkNumber = req.param('flowChunkNumber', 0);
        var chunkSize = req.param('flowChunkSize', 0);
        var totalSize = req.param('flowTotalSize', 0);
        var identifier = req.param('flowIdentifier', "");
        var filename = req.param('flowFilename', "");

        req.flow = {
            status: null,
            identifier: identifier,
            filename: filename,
            chunkNumber: chunkNumber,
            chunkSize: chunkSize,
            totalSize: totalSize
        };

        if (validateRequest(chunkNumber, chunkSize, totalSize, identifier, filename) == 'valid') {
            var chunkFilename = getChunkFilename(chunkNumber, identifier);
            fs.exists(chunkFilename, function(exists) {
                if (exists) {
                    req.flow.status = 'found';
                    next();
                } else {
                    req.flow.status = 'not_found';
                    next(new Error('not_found'));
                }
            });
        } else {
            req.flow.status = 'not_found';
            next(new Error('not_found'));
        }
    };

    /**
     * ### req.flow.status values
     *  - partly_done
     *  - done
     *  - invalid_flow_request
     *  - non_flow_request
     */
    
    // ## Middleware


    /**
     * @method post
     * @description This is middleware that you use with express that populates req.flow as it executes
     * @param {Object} req express request object
     * @param {Object} res express response object
     * @param {Function} next continue to next middleware
     */
    $.post = function(req, res, next) {

        var fields = req.body;
        var files = req.files;

        var chunkNumber = fields['flowChunkNumber'];
        var chunkSize = fields['flowChunkSize'];
        var totalSize = fields['flowTotalSize'];
        var identifier = cleanIdentifier(fields['flowIdentifier']);
        var filename = fields['flowFilename'];

        var numberOfChunks = Math.max(Math.floor(totalSize/(chunkSize*1.0)), 1);

        // ## req.flow population
        req.flow = {
            status: null, // current status of upload
            identifier: identifier, // flowjs identifier
            filename: filename, // original filename uploaded
            chunkNumber: chunkNumber, // the current chunk being worked on
            numberOfChunks: numberOfChunks, // the total number of chunks being worked on
            chunkSize: chunkSize, // the size of each chunk sent
            totalSize: totalSize, // the total size of file upload
        };

        if (!files[$.fileParameterName] || !files[$.fileParameterName].size) {
            req.flow.status = 'invalid_flow_request';
            next(new Error('invalid_flow_request'));
            return;
        }

        req.flow.original_filename = files[$.fileParameterName]['originalFilename'];
        req.flow.validation = validateRequest(chunkNumber, chunkSize, totalSize, identifier, filename, files[$.fileParameterName].size);

        if (req.flow.validation == 'valid') {

            var chunkFilename = getChunkFilename(chunkNumber, identifier);

            fs.rename(files[$.fileParameterName].path, chunkFilename, function(err) {

                if (err) {
                    next(err);
                } else {
                    var currentTestChunk = 1;
                    var testChunkExists = function() {
                        fs.exists(getChunkFilename(currentTestChunk, identifier), function(exists){
                            if(exists){
                                currentTestChunk++;
                                if(currentTestChunk>numberOfChunks) {
                                    req.flow.status = 'done';
                                    req.flow.currentTestChunk = currentTestChunk;
                                    next();
                                } else {
                                   // Recursion
                                   testChunkExists();
                                }
                            } else {
                                req.flow.status = 'partly_done';
                                req.flow.currentTestChunk = currentTestChunk;
                                next();
                            }
                        });
                    }
                    testChunkExists();
                }
            });
        } else {
            next(new Error(req.flow.validation));
        }
    };

    // ### Utility

    /**
     * @method write
     * @description Pipe chunks directly into an existing WriteableStream
     * @param {String} identifier flowjs file id found at req.flow.identifier
     * @param {Object} writeableStream an instance of fs.createWriteStream
     * @param {Object} options
     */
    $.write = function(identifier, writableStream, options) {
        options = options || {};
        options.end = (typeof options['end'] == 'undefined' ? true : options['end']);

        // Iterate over each chunk
        var pipeChunk = function(number) {

            var chunkFilename = getChunkFilename(number, identifier);
            fs.exists(chunkFilename, function(exists) {

                if (exists) {
                    // If the chunk with the current number exists,
                    // then create a ReadStream from the file
                    // and pipe it to the specified writableStream.
                    var sourceStream = fs.createReadStream(chunkFilename);
                    sourceStream.pipe(writableStream, {
                        end: false
                    });
                    sourceStream.on('end', function() {
                        // When the chunk is fully streamed,
                        // jump to the next one
                        pipeChunk(number + 1);
                    });
                } else {
                    // When all the chunks have been piped, end the stream
                    if (options.end) writableStream.end();
                    if (options.onDone) options.onDone();
                }
            });
        };
        pipeChunk(1);
    };

    /**
     * @method clean
     * @description 
     * @param  {String} identifier found at req.flow.identifer
     * @param  {Function} done callback
     */
    $.clean = function(identifier, done) {
        var options = options || {};
        // Iterate over each chunk
        var pipeChunkRm = function(number) {

            var chunkFilename = getChunkFilename(number, identifier);
            fs.exists(chunkFilename, function(exists) {
                if (exists) {
                    fs.unlink(chunkFilename, function(err) {
                        if (err) {
                            if (done) {
                                done(err);
                            }
                        } else {
                            pipeChunkRm(number + 1);
                        }
                    });
                } else {
                    if (done) {
                        done(null);
                    }
                }
            });
        };
        pipeChunkRm(1);
    };

    // ### Internal Use Methods

    function cleanIdentifier(identifier) {
        return identifier.replace(/[^0-9A-Za-z_-]/g, '');
    }

    function getChunkFilename(chunkNumber, identifier) {
        // Clean up the identifier
        identifier = cleanIdentifier(identifier);
        // What would the file name be?
        return path.resolve($.temporaryFolder, './flow-' + identifier + '.' + chunkNumber);
    }

    function validateRequest(chunkNumber, chunkSize, totalSize, identifier, filename, fileSize) {
        // Clean up the identifier
        identifier = cleanIdentifier(identifier);

        // Check if the request is sane
        if (chunkNumber == 0 || chunkSize == 0 || totalSize == 0 || identifier.length == 0 || filename.length == 0) {
            return 'non_flow_request';
        }
        var numberOfChunks = Math.max(Math.floor(totalSize / (chunkSize * 1.0)), 1);
        if (chunkNumber > numberOfChunks) {
            return 'invalid_flow_request1';
        }

        // Is the file too big?
        if ($.maxFileSize && totalSize > $.maxFileSize) {
            return 'invalid_flow_request2';
        }

        if (typeof(fileSize) != 'undefined') {
            if (chunkNumber < numberOfChunks && fileSize != chunkSize) {
                // The chunk in the POST request isn't the correct size
                return 'invalid_flow_request3';
            }
            if (numberOfChunks > 1 && chunkNumber == numberOfChunks && fileSize != ((totalSize % chunkSize) + parseInt(chunkSize))) {
                // The chunks in the POST is the last one, and the fil is not the correct size
                return 'invalid_flow_request4';
            }
            if (numberOfChunks == 1 && fileSize != totalSize) {
                // The file is only a single chunk, and the data size does not fit
                return 'invalid_flow_request5';
            }
        }

        return 'valid';
    }

    return $;
};