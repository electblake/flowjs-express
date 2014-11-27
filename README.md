# FlowJS for Express

**This module is experimental** - use at own risk - cobbled together from various online sources I've come across.

code snippet to start with, not that you probably can't copy paste - read it over until I get real documentation.


```
var savePath = './';
router.post('/:save_id', function(req, res, next) {
  flow.post(req, function(status, filename, original_filename, identifier) {
    var chunkNumber = req.body.flowChunkNumber,
    	totalChunks = req.body.flowTotalChunks;
    	
	var s = fs.createWriteStream(savePath);
	s.on('finish', function() {
		console.log('-- finished (' + chunkNumber + ')', totalChunks);
		if (chunkNumber === totalChunks) {
			console.log('-- next (' + chunkNumber + ')', totalChunks);
			next();
		} else {
			res.status(200).send();
		}
	});
    flow.write(identifier, s, {end: true});
  });
});
```