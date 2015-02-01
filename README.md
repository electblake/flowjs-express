# FlowJS for Express

https://travis-ci.org/electblake/flowjs-express.svg?branch=master

## This module is experimental
**use at own risk**

Code snippet to start with, not that you probably can't copy paste - read it over until I get real documentation.


```
var temporaryFolder = path.resolve(path.join('./', 'uploads-tmp'));
var flow = require('flowjs-express')(temporaryFolder);
var saveFolder = path.resolve(path.join('./', 'uploads'));

app.post('/uploads', flow.post, function(req, res, next) {
	log.debug('req.flow.status', req.flow.status);
	if (req.flow.status === 'done') {

		// req.flow is populated with great info
		console.log('Upload Done', req.flow);
		
		var file_ext = path.extname(req.flow.filename);
		var save_path = path.join(saveFolder, 'custom-name' + file_ext);

	    var saveStream = fs.createWriteStream(save_path);
	    flow.write(req.flow.identifier, saveStream);

	    saveStream.on('finish', function() {
	    	// file is finished writing
	    	res.send(save_path);

	    }).on('error', function(err) {
	    	res.sendStatus(400);
	    });

	} else {
		res.sendStatus(200);
	}
});
```
