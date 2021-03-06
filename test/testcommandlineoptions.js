var http = require('http'),
	url = require('url'),
	phantom = require('../node-phantom'),
	usingProxy = false,
	phantomInstance;

var proxyServer=http.createServer(function(request, response){
	var requestedUrl = url.parse(request.url);
	if(requestedUrl.path === '/testPhantomPagePushNotifications'){
		usingProxy = true;
		response.writeHead(200,{"Content-Type": "text/html"});
		response.end('okay');
		return;
	}
	var req = http.request(
		{
			hostname: requestedUrl.hostname,
			port: requestedUrl.port,
			path: requestedUrl.path,
			method: request.method
		},
		function(res){
			response.writeHead(res.statusCode, res.headers);
			res.on('data', function(data){
				response.write(data)
			});
			res.on('end', function(){
				response.end()
			});
		}
	);
	req.on('error', function(error){
		console.log(error);
		response.end();
		phantomInstance && phantomInstance.exit();
		proxyServer.close();
	});
	req.end();
}).listen();

exports.testPhantomPagePushNotifications = function(beforeExit, assert) {
	phantom.create(errOr(function(ph){
		phantomInstance = ph;
		ph.createPage(errOr(function(page){
			page.open('http://localhost/testPhantomPagePushNotifications', errOr(function(){
				ph.exit(function(){
					proxyServer.close();
				});
			}));
		}));
	}), ['--proxy=localhost:' + proxyServer.address().port]);

	beforeExit(function(){
		assert.eql(usingProxy, true);
	});

	function errOr(fn) {
		return function(err, res) {
			assert.ifError(err);
			fn(res);
		}
	}
};