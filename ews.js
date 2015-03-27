var ws = require('ws');
var util = require('util');
var Promise = require('bluebird').Promise;
var uuid = require('node-uuid');
var EventEmitter = require('events').EventEmitter;

function newCall(Cls, args) {
  args.unshift(null);
  return new (Function.prototype.bind.apply(Cls, args));
}

function WebSocket(wsInstance) {  
  var args = Array.prototype.slice.call(arguments);
  EventEmitter.call(this);

  this.responseTimeout = 10000;

  var requestMap = this.requestMap  = {};

  var self = this;
  if(wsInstance && wsInstance instanceof ws) {
    this.wsClient = wsInstance;
  } else {
    this.wsClient = newCall(ws, args);
  }
  this.wsClient.on('message', function(msg) {
    var obj = JSON.parse(msg);
    try {
      self.emit('message', obj);
      if(obj.type) {
        if(obj.uuid) {
          self.emit('request:'+obj.type, obj.data, function(error, responseData) {
            self.send({
              error: error,
              type: obj.type,
              response: obj.uuid,
              data: responseData
            });
          });
        } else if(obj.response) {
          if(requestMap[obj.response]) {
            if(obj.error) {
              requestMap[obj.response].error(obj.error);
            }
            else {
              requestMap[obj.response](obj.data);
            }
          }
          else {
            console.error('Got response without a request', obj.response);
          }
        } else {
          self.emit('event:'+obj.type, obj.data);
        }
      }
    } catch(err) {
      self.emit('messageParseError', err, msg);
    }
  });

  this.wsClient.on('open', function() {
    self.emit('open');
  });
}

util.inherits(WebSocket, EventEmitter);

WebSocket.prototype.send = function(msg, cb) {
  this.wsClient.send(JSON.stringify(msg), cb);
};

WebSocket.prototype.sendRequest = function(type, data, cb) {
  var self = this;
  var obj;
  var requestMap = this.requestMap;
  return (new Promise(function(resolve, reject) {
    obj = {
      type: type,
      data: data,
      uuid: uuid.v4()
    };
    self.send(obj, function ack(error) {
      if(error) reject(error);
       // sent successfuly, wait for response

      requestMap[obj.uuid] = function(data) {
        resolve(data);
        delete requestMap[obj.uuid];
      };
      requestMap[obj.uuid].error = function(error) {
        reject(error);
        delete requestMap[obj.uuid];
      };
    });
  })).timeout(self.responseTimeout).catch(Promise.TimeoutError, function(err) {
    delete requestMap[obj.uuid];
    throw err;
  })
  .nodeify(cb);
};



function makeRequestHandler(cb) {
  return function requestHandler(data, responseCb) {
    Promise.method(cb)(data).nodeify(responseCb);
  }
}

WebSocket.prototype.onRequest = function(name, cb) {
  this.on('request:'+name, makeRequestHandler(cb));
};

WebSocket.prototype.onceRequest = function(name, cb) {
  this.once('request:'+name, makeRequestHandler(cb));
};

WebSocket.prototype.onEvent = function(name, cb) {
  this.on('event:'+name, cb);
};

WebSocket.prototype.onceEvent = function(name, cb) {
  this.once('event:'+name, cb);
};

WebSocket.prototype.offEvent = function(name, cb) {
  if(cb)
    this.removeEventListener('event:' + name, cb);
  else
    this.removeAllListeners('event:' + name);
};

WebSocket.prototype.offRequest = function(name, cb) {
  if(cb)
    this.removeEventListener('request:' + name, cb);
  else
    this.removeAllListeners('request:' + name);
};

WebSocket.prototype.setResponseTimeout = function(timeout) {
  this.responseTimeout = parseInt(timeout);
};

WebSocket.prototype.sendEvent = function(type, data, cb) {
  var self = this;
  return (new Promise(function(resolve, reject) {
    var obj = {
      type: type,
      data: data
    };
    self.send(obj);
  })).nodeify(cb);
};

function WebSocketServer() {
  var args = Array.prototype.slice.call(arguments);
  EventEmitter.call(this);

  var self = this;
  this.wsServer = newCall(ws.Server, args);
  this.wsServer.on('connection', function(ws) {
    self.emit('connection', new WebSocket(ws));
  });

  function forwardEventsFor(eventName) {
    self.wsServer.on(eventName, function() {
      var args = Array.prototype.slice.call(arguments);
      args.unshift(eventName);
      self.emit.apply(self, args);
    });
  }
  forwardEventsFor('listening');
}

util.inherits(WebSocketServer, EventEmitter);

function forwardCall(name) {
  WebSocketServer.prototype[name] = function() {
    this.wsServer[name].call(this.wsServer, arguments);
  };
}

forwardCall('close');

WebSocket.Server = WebSocketServer;
module.exports = WebSocket;