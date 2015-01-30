var fs = require('fs-extra'),
    path = require('path');
/**
 * [flow description]
 * @param string temporaryFolder full path to tmp folder
 * @return {[type]}
 */
module.exports = flow = function(temporaryFolder) {
    var $ = this;
    $.temporaryFolder = temporaryFolder;
    $.maxFileSize = null;
    $.fileParameterName = 'file';
    
    fs.ensureDir($.temporaryFolder);

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

    /**
     * GET flow middleware
     * req.flow.status
     *  - found
     *  - not_found
     */
    //'found', filename, original_filename, identifier
    //'not_found', null, null, null
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
     * POST flow middleware
     * populates req.flow
     * 
     * req.flow.status
     *  - partly_done
     *  - done
     *  - invalid_flow_request
     *  - non_flow_request
     */
    $.post = function(req, res, next) {

        var fields = req.body;
        var files = req.files;

        // console.log('--- flow req.files', files);

        var chunkNumber = fields['flowChunkNumber'];
        var chunkSize = fields['flowChunkSize'];
        var totalSize = fields['flowTotalSize'];
        var identifier = cleanIdentifier(fields['flowIdentifier']);
        var filename = fields['flowFilename'];

        var numberOfChunks = Math.max(Math.floor(totalSize/(chunkSize*1.0)), 1);

        req.flow = {
            status: null,
            identifier: identifier,
            filename: filename,
            chunkNumber: chunkNumber,
            numberOfChunks: numberOfChunks,
            chunkSize: chunkSize,
            totalSize: totalSize,
        };

        // console.log('-- flow.post fields', fields);

        // console.log('--- flow.post receiver chunk', chunkNumber);

        if (!files[$.fileParameterName] || !files[$.fileParameterName].size) {
            req.flow.status = 'invalid_flow_request';
            next(new Error('invalid_flow_request'));
            return;
        }

        req.flow.original_filename = files[$.fileParameterName]['originalFilename'];
        req.flow.validation = validateRequest(chunkNumber, chunkSize, totalSize, identifier, filename, files[$.fileParameterName].size);

        if (req.flow.validation == 'valid') {

            var chunkFilename = getChunkFilename(chunkNumber, identifier);

            // console.log('-- moving upload', files[$.fileParameterName].path, chunkFilename);
            // Save the chunk (TODO: OVERWRITE)
            fs.rename(files[$.fileParameterName].path, chunkFilename, function(err) {

                if (err) {
                    // debug('rename error', err);
                } else {
                    // Do we have all the chunks?
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

                             //Add currentTestChunk and numberOfChunks to the callback
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

    // Pipe chunks directly in to an existsing WritableStream
    //   r.write(identifier, response);
    //   r.write(identifier, response, {end:false});
    //
    //   var stream = fs.createWriteStream(filename);
    //   r.write(identifier, stream);
    //   stream.on('data', function(data){...});
    //   stream.on('finish', function(){...});
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

    return $;
};