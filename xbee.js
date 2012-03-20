var util = require('util');
var EventEmitter = require('events').EventEmitter;
var api = require("./xbee-api");
var serialport = require("serialport");
var async = require('async');

function XBee(port) {
  EventEmitter.call(this);

  this.nodes = {};

  this.serial = new serialport.SerialPort(port, { 
    parser: api.packetParser()
  });

  var self = this;

  this._onNodeDiscovery = function(node) {
    // RemoveAllListeners??ß
    if (self.nodes[node.remote64.hex]) {
      self.nodes[node.remote64.hex].removeAllListeners();
    } else {
      self.nodes[node.remote64.hex] = new Node(self, node);
    }
    this.emit("node", self.nodes[node.remote64.hex]);
  }

  // On AT Response
  this._onRemoteATResponse = function(res) {
    // On Node Discovery Packet, emit new Node
    if (self.nodes[res.remote64.dec]) {
      self.nodes[res.remote64.dec]._onRemoteATResponse(res);
    } else {
      console.log("Unhandled REMOTE_AT_RESPONSE: %s", util.inspect(res));
    }
  }

  this._onATResponse_FilterND = function(res) {
    if (res.command == "ND") self._onNodeDiscovery(res.node);
  }

  this._onMessage = function(data) {
    if (self.nodes[data.remote64.hex]) {
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
  var QF = function(command, f) {
    f = typeof f !== 'undefined' ? f : function(a){return a};
    return function(cb) {
      self._ATCB(command, function(data) {
        cb(!data.commandStatus, f(data.commandData)); 
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
  
  async.series(config, function(err, results) {
    console.log(results);
    self.config = results;
    self.emit("configured", self.config);
    self.discover(function() {
      console.log("Discovery Over");
    });
  });
}

XBee.prototype.discover = function(cb) {
  this._AT('ND');
  this.serial.on("AT_RESPONSE", this._onATResponse_FilterND);
  setTimeout(function() {
    cb(); 
  }, this.config.nodeDiscoveryTime);
}

XBee.prototype.broadcast = function(data) {
  var remote64 = [0x00,0x00,0x00,0x00,0x00,0x00,0xff,0xff];
  var remote16 = [0xff,0xfe]; 
  this._send(data, remote64, remote16);
}

XBee._send = function(data, remote64, remote16) {
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
}

XBee.prototype._ATCB = function(cmd, val, cb) {
  if (typeof val === 'function') {
    cb = val;
    val = undefined;
  }
  this._AT(cmd, val);
  this.serial.on("AT_RESPONSE", function(res) {
    if (res.command == cmd) {
      cb(res);
    }
  });
}

XBee.prototype._AT = function(cmd, val) {
  var frame = new api.ATCommand();
  frame.setCommand(cmd);
  frame.commandParameter = val;
  this.serial.write(frame.getBytes());
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
}

exports.XBee = XBee;

function Node(xbee, params) {
  EventEmitter.call(this);
  this.xbee = xbee;
  this.id = params.id;
  this.remote16 = params.remote16;
  this.remote64 = params.remote64;
}


Node.prototype.send = function(data) {
  this.xbee._send(data, this.remote64, this.remote16);
}

Node.prototype._AT = function(cmd, val) {
  this.xbee._remoteAT(cmd, this.remote64, this.remote16, val);
}

Node.prototype._onATResponse = function(res) {
  console.log("Node %s got AT_RESPONSE: %s", util.inspect(res));
}

util.inherits(Node, EventEmitter);
