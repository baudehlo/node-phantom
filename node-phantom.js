//Released to the public domain.

var http=require('http');
var socketio=require('socket.io');
var child=require('child_process');

function callbackOrDummy(callback) {
    if (callback === undefined) callback = function(){};
    return callback;
}

function unwrapArray(arr) {
    return arr && arr.length == 1 ? arr[0] : arr
}

module.exports = {
    create: function(callback, options) {
        if (options === undefined) options = {};
        if (options.phantomPath === undefined) options.phantomPath = 'phantomjs';
        if (options.parameters === undefined) options.parameters = {};

        function spawnPhantom(port, callback) {
            var args=[];
            for(var parm in options.parameters) {
                args.push('--' + parm + '=' + options.parameters[parm]);
            }
            args=args.concat([__dirname + '/bridge.js', port]);

            var phantom=child.spawn(options.phantomPath,args);
            phantom.stdout.on('data',function(data){
                return console.log('phantom stdout: '+data);
            });
            phantom.stderr.on('data',function(data){
                return console.warn('phantom stderr: '+data);
            });
            var exitCode = 0;
            phantom.on('exit',function(code){
                exitCode = code;
            });
            setTimeout(function(){    //wait a bit to see if the spawning of phantomjs immediately fails due to bad path or similar
            	if (exitCode !== 0) {
            		return callback("Phantom immediately exited with: " + exitCode);
            	}
                callback(null, phantom);
            },100);
        };
        
        var server = http.createServer(function(request,response) {
            response.writeHead(200,{"Content-Type": "text/html"});
            response.end('<html><head><script src="/socket.io/socket.io.js" type="text/javascript"></script><script type="text/javascript">\n\
                window.onload=function(){\n\
                    var socket = new io.connect("http://" + window.location.hostname);\n\
                    socket.on("cmd", function(msg){\n\
                        alert(msg);\n\
                    });\n\
                    window.socket = socket;\n\
                };\n\
            </script></head><body></body></html>');
        }).listen(function () {
	        var io = socketio.listen(server,{'log level':1});
	        var port = server.address().port;
	        var phantom = spawnPhantom(port, function(err,phantom) {
	            if (err) {
	                try {
	                    server.close();
	                } catch (e) {
	                    console.log('Error closing server:', e);
	                }
	                return callback(err);
	            }
	            
	            var pages = {};
	            var cmds = {};
	            var cmdid = 0;
	            
	            function request(socket,args,callback){
	                args.splice(1,0,cmdid);
	    //            console.log('requesting:'+args);
	                socket.emit('cmd',JSON.stringify(args));

	                cmds[cmdid] = {cb:callback};
	                cmdid++;
	            }
	            
	            io.sockets.on('connection', function(socket) {
	                // When Socket.io connection opens, immediately clear the timeout.
	                socket.on('res', function(response) {
	    //                console.log(response);
	                    var id = response[0];
	                    var cmdId = response[1];
	                    switch (response[2]) {
	                    case 'pageCreated':
	                        var pageProxy = {
	                            open: function(url, callback) {
	                                if (callback === undefined) {
	                                    request(socket, [id, 'pageOpen', url]);
	                                } else {
	                                    request(socket, [id, 'pageOpenWithCallback', url], callback);
	                                }
	                            },
	                            close:function(callback){
	                                request(socket, [id, 'pageClose'], callbackOrDummy(callback));
	                            },
	                            render:function(filename, callback){
	                                request(socket, [id, 'pageRender', filename], callbackOrDummy(callback));
	                            },
	                            renderBase64:function(extension, callback){
	                                request(socket, [id, 'pageRenderBase64', extension], callbackOrDummy(callback));
	                            },
	                            injectJs:function(url, callback){
	                                request(socket, [id, 'pageInjectJs', url], callbackOrDummy(callback));
	                            },
	                            includeJs:function(url, callback){
	                                request(socket, [id, 'pageIncludeJs', url], callbackOrDummy(callback));
	                            },
	                            sendEvent:function(event, x, y, callback){
	                                request(socket, [id,'pageSendEvent',event,x,y],callbackOrDummy(callback));
	                            },
	                            uploadFile:function(selector, filename, callback){
	                                request(socket, [id, 'pageUploadFile',selector, filename],callbackOrDummy(callback));
	                            },
	                            evaluate:function(evaluator, callback){
	                                request(socket, [id, 'pageEvaluate', evaluator.toString()].concat(Array.prototype.slice.call(arguments, 2)),callbackOrDummy(callback));
	                            },
	                            set:function(name, value, callback){
	                                request(socket, [id, 'pageSet', name, value], callbackOrDummy(callback));
	                            },
	                            get:function(name, callback){
	                                request(socket, [id, 'pageGet', name], callbackOrDummy(callback));
	                            },
	                            setFn: function(pageCallbackName, fn, callback) {
	                                request(socket, [id, 'pageSetFn', pageCallbackName, fn.toString()], callbackOrDummy(callback));
	                            }
	                        };
	                        pages[id] = pageProxy;
	                        cmds[cmdId].cb(null,pageProxy);
	                        delete cmds[cmdId];
	                        break;
	                    case 'phantomExited':
	                        request(socket,[0,'exitAck']);
	                        try {
	                            server.close();
	                        } catch (e) {
	                            console.log('Error closing server:', e);
	                        }
	                        io.set('client store expiration', 0);
	                        cmds[cmdId].cb();
	                        delete cmds[cmdId];
	                        break;
	                    case 'pageJsInjected':
	                    case 'jsInjected':
	                        cmds[cmdId].cb(JSON.parse(response[3]) === true ? null : true);
	                        delete cmds[cmdId];
	                        break;
	                    case 'pageOpened':
	                        if(cmds[cmdId] !== undefined){    //if page is redirected, the pageopen event is called again - we do not want that currently.
	                            if(cmds[cmdId].cb !== undefined){
	                                cmds[cmdId].cb(null, response[3]);
	                            }
	                            delete cmds[cmdId];
	                        }
	                        break;
	                    case 'pageRenderBase64Done':
	                        cmds[cmdId].cb(null, response[3]);
	                        delete cmds[cmdId];
	                        break;
	                    case 'pageGetDone':
	                    case 'pageEvaluated':
	                        cmds[cmdId].cb(null, JSON.parse(response[3]));
	                        delete cmds[cmdId];
	                        break;
	                    case 'pageClosed':
	                        delete pages[id]; // fallthru
	                    case 'pageSetDone':
	                    case 'pageJsIncluded':
	                    case 'cookieAdded':
	                    case 'pageRendered':
	                    case 'pageEventSent':
	                    case 'pageFileUploaded':
	                        cmds[cmdId].cb(null);
	                        delete cmds[cmdId];
	                        break;
	                    default:
	                        console.error('got unrecognized response:' + response);
	                        break;
	                    }                
	                });        
	                
	                socket.on('push', function(request) {
	                    var id = request[0];
	                    var cmd = request[1];
	                    var callback = callbackOrDummy(pages[id] ? pages[id][cmd] : undefined);
	                    callback(unwrapArray(request[2]));
	                });
	                
	                socket.on('disconnect', function() {
	                    console.log('Socket disconnect:', cmds);
	                    for (var cmdId in cmds) if (cmds.hasOwnProperty(cmdId)) {
	                        if (cmds[cmdId].cb) cmds[cmdId].cb(true);
	                        delete cmds[cmdId];
	                    }
	                    io.set('client store expiration', 0);
	                });
	                
	                var proxy = {
	                    createPage: function(callback) {
	                        request(socket, [0,'createPage'], callbackOrDummy(callback));
	                    },
	                    injectJs: function(filename,callback){
	                        request(socket, [0,'injectJs', filename], callbackOrDummy(callback));
	                    },
	                    addCookie: function(cookie, callback){
	                        request(socket, [0,'addCookie', cookie], callbackOrDummy(callback));
	                    },                 
	                    exit: function(callback){
	                        request(socket, [0,'exit'], callbackOrDummy(callback));
	                        phantom.kill('SIGTERM');
	                    },
	                    on: function(){
	                        phantom.on.apply(phantom, arguments);
	                    }
	                };
	                
	                callback(null, proxy);
	            });

	            // An exit event listener that is registered AFTER the phantomjs process
	            // is successfully created.
	            phantom.on('exit', function(code, signal){
	                // Close server upon phantom crash.
	                if (code !== 0 && signal === null){
	                    console.warn('phantom crash: code '+code);
	                    try {
	                        server.close();
	                    } catch (e) {
	                        console.log('Error closing server:', e);
	                    }
	                }
	                else {
	                    console.warn('phantom signal:', signal);
	                    try {
	                        server.close();
	                    } catch (e) {
	                        console.log('Error closing server:', e);
	                    }
	                 }
	            });
	        });
		});


    }
};
