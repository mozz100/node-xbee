var util = require('util');
var EventEmitter = require('events').EventEmitter;
var api = require("./xbee-api");
var serialport = require("serialport");
var async = require('async');

function XBee(options, data_parser) { 
  EventEmitter.call(this);

  if (typeof options === 'string') {
    options = {port: options};
  }

  if (typeof data_parser !== 'function') {
    console.log("loading simple parser");
    data_parser = require("./simple-parser"); 
  }
  // Current nodes
  this.nodes = {};

  // Serial connection to the XBee
  this.serial = new serialport.SerialPort(options.port, { 
    baudrate: options.baudrate || 57600,
    parser: api.packetBuilder()
  });

  var self = this;

  this._onNodeDiscovery = function(data) {
    var node = data.node;
    if (!self.nodes[node.remote64.hex]) {
      self.nodes[node.remote64.hex] = new Node(self, node, data_parser);
      self.emit("node", self.nodes[node.remote64.hex]);
    } else {
      self.nodes[node.remote64.hex].emit("reconnect");
      // RemoveAllListeners??ß
      // self.nodes[node.remote64.hex].removeAllListeners();
      //
    }
  }

  // On AT Response
  this._onRemoteATResponse = function(res) {
    // On Node Discovery Packet, emit new Node
    if (self.nodes[res.remote64.hex]) {
      self.nodes[res.remote64.hex]._onRemoteATResponse(res);
    } else {
      console.log("Unhandled REMOTE_AT_RESPONSE: %s", util.inspect(res));
    }
  }

  this._onMessage = function(data) {
    if (self.nodes[data.remote64.hex]) {
      //console.log("Data for %s", data.remote64.hex);
      self.nodes[data.remote64.hex]._onData(data);
    } else {
      console.log("ERROR: Data from unknown node!");
    }
  }

  this.serial.on("REMOTE_AT_RESPONSE", this._onRemoteATResponse);
  this.serial.on("NODE_IDENTIFICATION", this._onNodeDiscovery);
  this.serial.on("RECEIVE_RF_DATA", this._onMessage);

  this.configure();
}

util.inherits(XBee, EventEmitter);

XBee.prototype.configure = function() {
  var self = this;

  // Returns a function that initiates an AT command to
  // query a configuration parameter's value. 
  // To be passed to an async.parallel.
  var QF = function(command, f) { // Format the result using f
    f = typeof f !== 'undefined' ? f : function(a){return a};
    return function(cb) {
      self._ATCB(command, function(data) {
        cb(!(data.commandStatus==0x00), f(data.commandData)); 
      });
    }
  }

  var config = {
    panid:      QF('ID', api.bArr2HexStr),
    id:         QF('NI', api.bArr2Str),
    sourceLow:  QF('SL', api.bArr2HexStr),
    sourceHigh: QF('SH', api.bArr2HexStr),
    nodeDiscoveryTime: QF('NT', function(a) { return parseInt(a[0])*100; })
  };
  
  // Using async to start discovery only when all parameters have been read.
  async.parallel(config, function(err, results) {
    self.config = results;
    self.emit("configured", self.config);
    self.discover(function() {
      console.log("=======================");
    });
  });
}

// Run network discovery. Associated nodes can report in
// for config.nodeDiscoveryTime ms.
XBee.prototype.discover = function(cb) {
  var frameId = this._AT('ND');
  var self = this;
  // Whenever a node reports in, treat him as rejoined.
  self.serial.on("AT_RESPONSE_"+frameId, self._onNodeDiscovery);
  // Wait for nodeDiscoveryTime ms before calling back
  setTimeout(function() {
    cb(); 
    self.serial.removeAllListeners("AT_RESPONSE_"+frameId);
  }, this.config.nodeDiscoveryTime);
}

XBee.prototype.broadcast = function(data) {
  var remote64 = [0x00,0x00,0x00,0x00,0x00,0x00,0xff,0xff];
  var remote16 = [0xff,0xfe]; 
  this._send(data, remote64, remote16);
}

XBee.prototype._send = function(data, remote64, remote16) {
  var frame = new api.TransmitRFData();
  if (typeof remote64.dec === 'undefined') {
    frame.destination64 = remote64;
    frame.destination16 = remote16;
  } else {
    frame.destination64 = remote64.dec;
    frame.destination16 = remote16.dec;
  }
  frame.RFData = data;
  this.serial.write(frame.getBytes());
  return frame.frameId;
}

XBee.prototype._ATCB = function(cmd, val, cb) {
  if (typeof val === 'function') {
    cb = val;
    val = undefined;
  }
  var frameId = this._AT(cmd, val);
  this.serial.once("AT_RESPONSE_"+frameId, cb);
}

XBee.prototype._AT = function(cmd, val) {
  var frame = new api.ATCommand();
  frame.setCommand(cmd);
  frame.commandParameter = val;
  this.serial.write(frame.getBytes());
  return frame.frameId;
}

XBee.prototype._remoteAT = function(cmd, remote64, remote16, val) {
  var frame = new api.ATCommand();
  frame.setCommand(cmd);
  frame.commandParameter = val;
  if (typeof remote64.dec === 'undefined') {
    frame.destination64 = remote64;
    frame.destination16 = remote16;
  } else {
    frame.destination64 = remote64.dec;
    frame.destination16 = remote16.dec;
  }
  this.serial.write(frame.getBytes());
  return frame.frameId;
}

exports.XBee = XBee;

function Node(xbee, params, data_parser) {
  EventEmitter.call(this);
  this.xbee = xbee;
  this.id = params.id;
  this.remote16 = params.remote16;
  this.remote64 = params.remote64;
  this.buffer = "";
  this.parser = data_parser(this);
}
util.inherits(Node, EventEmitter);

Node.prototype.send = function(data, cb) {
  var frameId = this.xbee._send(data, this.remote64, this.remote16);
  if (typeof cb === 'function') {
    this.xbee.serial.once("TX_TRANSMIT_STATUS_"+frameId, function(data) {
      var error = false;
      if (data.deliveryStatus != 0x00) {
        error = data;
        error.msg = api.DELIVERY_STATES[data.deliveryStatus];
      }
      cb(error);
    });
  }
}

Node.prototype._onData = function(data) {
  // Send the whole data object, or just the parsed msg?
  this.parser.parse(api.bArr2Str(data.rawData));
}

Node.prototype._AT = function(cmd, val) {
  this.xbee._remoteAT(cmd, this.remote64, this.remote16, val);
}

Node.prototype._onATResponse = function(res) {
  console.log("Node %s got AT_RESPONSE: %s", util.inspect(res));
}

exports.Node = Node;
