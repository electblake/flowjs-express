var grunt = require('grunt');

module.exports = function(grunt) {
	require('load-grunt-tasks')(grunt);

	grunt.initConfig({
		pkg: grunt.file.readJSON('package.json'),
		watch: {
		  docs: {
		    files: ['index.js'],
		    tasks: ['groc']
		  }
		},
		groc: {
			javascript: ["index.js"]
		}
	});

	// build into deliverable app
	grunt.registerTask('default', [
	  'groc'
	]);

}