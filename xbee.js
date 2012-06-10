var util = require('util');
var EventEmitter = require('events').EventEmitter;
var api = require("./xbee-api");
var serialport = require("serialport2");
var async = require('async');
//var serialport = require("serialport");

var C = api.Constants;

function XBee(options, data_parser) { 
  EventEmitter.call(this);
  var self = this;

  // Option Parsing
  if (typeof options === 'string') {
    options = {port: options};
  }

  if (typeof data_parser !== 'function') {
    console.log("Loading simple parser, data will emitted on \\r\\n delimiter.");
    data_parser = require("./simple-parser"); 
  }

  // Current nodes
  self.nodes = {};

  // Assembles frames from serial port
  self.packetBuilder = api.packetBuilder();

  // Serial connection to the XBee
  self.serial = new serialport.SerialPort();
  self.serial.open(options.port, { 
    baudRate: options.baudrate || 57600,
    dataBits: 8,
    parity: 'none',
    stopBits: 1
  }, function(err) {
    if (err) console.log("ERROR: "+err);
    else self.configure();
  });

  // Forward data to PacketBuilder
  self.serial.on("data", function(buffer) {
    self.packetBuilder(self, buffer);
  });

  

  /* Frame-specific Handlers */

  // Whenever a node is identified (on ATND command).
  self._onNodeIdentification = function(data) {
    var node = data.node;
    if (!self.nodes[node.remote64.hex]) {
      self.nodes[node.remote64.hex] = new Node(self, node, data_parser);
      self.emit("node", self.nodes[node.remote64.hex]);
    } else {
      self.nodes[node.remote64.hex].emit("reconnect");
      // RemoveAllListeners?
      // self.nodes[node.remote64.hex].removeAllListeners();
      //
    }
  }

  // AT Command Responses from remote AT Commands
  self._onRemoteCommandResponse = function(res) {
    // On Node Discovery Packet, emit new Node
    if (self.nodes[res.remote64.hex]) {
      self.nodes[res.remote64.hex]._onRemoteCommandResponse(res);
    } else {
      console.log("Unhandled REMOTE_AT_RESPONSE: %s", util.inspect(res));
    }
  }

  // Messages
  self._onReceivePacket = function(data) {
    if (self.nodes[data.remote64.hex]) {
      //console.log("Data for %s", data.remote64.hex);
      self.nodes[data.remote64.hex]._onReceivePacket(data);
    } else {
      console.log("ERROR: Data from unknown node!");
    }
  }

  // Data samples (from XBee's I/O)
  self._onDataSampleRx = function(data) {
    if (self.nodes[data.remote64.hex]) {
      self.nodes[data.remote64.hex]._onDataSampleRx(data);
    } else {
      console.log("ERROR: Data sample from unknown node!");
    }
  }

  self.on(C.FRAME_TYPE.REMOTE_COMMAND_RESPONSE,  self._onRemoteCommandResponse);
  self.on(C.FRAME_TYPE.NODE_IDENTIFICATION,      self._onNodeIdentification);
  self.on(C.FRAME_TYPE.ZIGBEE_RECEIVE_PACKET,    self._onReceivePacket);
  self.on(C.FRAME_TYPE.ZIGBEE_IO_DATA_SAMPLE_RX, self._onDataSampleRx);
  
  self._queue = async.queue(function(task, callback) {
    async.series(task.tasks, function(err) {
      if (err) {
        console.log("~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~");
        console.log("Task series stopped with error: "+err.msg);
      }
      callback(err);
      if (typeof task._cb === 'function') task._cb(err);
    });
  }, 1);
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
    panid:             QF('ID', api.bArr2HexStr),
    id:                QF('NI', api.bArr2Str),
    sourceLow:         QF('SL', api.bArr2HexStr),
    sourceHigh:        QF('SH', api.bArr2HexStr),
    //maxPayloadSize:    QF('NP', api.bArr2HexStr), // Returns ERROR :/
    nodeDiscoveryTime: QF('NT', function(a) { return 100 * api.bArr2Dec(a); })
  };
  
  var done = function(err, results) {
    if (err) return console.log("Failure to configure XBee module: %s", err);
    self.config = results;
    self.emit("configured", self.config);
    self.discover(function() {
      console.log("=======================");
    });
  }

  // Using async to start discovery only when all parameters have been read.
  var res_stop = Object.keys(config).length;
  var results = {};
  for (k in config) {
    config[k]((function(key) {
      return function(err, data) {
        if (err) return done(err, null);
        results[key] = data; 
        // TODO: Timeout?
        if (--res_stop === 0) {
          done(null, results);
        }
      }
    })(k));
  }
}

// Run network discovery. Associated nodes can report in
// for config.nodeDiscoveryTime ms.
XBee.prototype.discover = function(cb) {
  var frameId = this._AT('ND');
  var self = this;
  var ATCBEvt = C.FRAME_TYPE.AT_COMMAND_RESPONSE + C.EVT_SEP + frameId;
  // Whenever a node reports in, treat him as rejoined.
  self.on(ATCBEvt, self._onNodeIdentification);
  // Wait for nodeDiscoveryTime ms before calling back
  setTimeout(function() {
    cb(); 
    self.removeAllListeners(ATCBEvt);
  }, this.config.nodeDiscoveryTime);
}

XBee.prototype.broadcast = function(data, cb) {
  var remote64 = [0x00,0x00,0x00,0x00,0x00,0x00,0xff,0xff];
  var remote16 = [0xff,0xfe]; 
  this._send(data, remote64, remote16, cb);
}

XBee.prototype._makeTask = function(bytes, frameId) {
  var self = this;
  var TXStatusCBEvt = C.FRAME_TYPE.ZIGBEE_TRANSMIT_STATUS + C.EVT_SEP + frameId;
  return function(cb) {
    //console.log("EVT: "+TXStatusCBEvt);
    //console.log("~~["+bytes.toString("ascii")+"]~~");
    self.serial.write(bytes);
    // TODO TIMEOUT!!
    self.once(TXStatusCBEvt, function(data) {
      //console.log("CB: "+TXStatusCBEvt);
      var error = null;
      if (data.deliveryStatus != C.DELIVERY_STATUS.SUCCESS) {
        error = data;
        error.msg = C.DELIVERY_STATUS[data.deliveryStatus];
      }
      cb(error);
    });
  }
}



XBee.prototype._send = function(data, remote64, remote16, _cb) {
  var self = this;
  var tasks = [];
  
  while (data.length > 0) {
    var frame = new api.TransmitRFData();
    frame.destination64 = remote64.dec;
    frame.destination16 = remote16.dec;
    frame.RFData = data.slice(0, C.MAX_PAYLOAD_SIZE);
    data = data.slice(C.MAX_PAYLOAD_SIZE);
    tasks.push(self._makeTask(frame.getBytes(), frame.frameId));
  }
  if (self._queue.length()>0) console.log("XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX");
  self._queue.push({ tasks: tasks, _cb: _cb });
}

XBee.prototype._ATCB = function(cmd, val, cb) {
  if (typeof val === 'function') {
    cb = val;
    val = undefined;
  }
  var frameId = this._AT(cmd, val);
  var ATCBEvt = C.FRAME_TYPE.AT_COMMAND_RESPONSE + C.EVT_SEP + frameId;
  this.once(ATCBEvt, cb);
}

XBee.prototype._AT = function(cmd, val) {
  var frame = new api.ATCommand();
  frame.setCommand(cmd);
  frame.commandParameter = val;
  //console.log("USE QUEUE!");
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
  //console.log("USE QUEUE!");
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
  this.xbee._send(data, this.remote64, this.remote16, cb);
}

Node.prototype._onReceivePacket = function(data) {
  // Send the whole data object, or just the parsed msg?
  this.parser.parse(api.bArr2Str(data.rawData));
}

Node.prototype._AT = function(cmd, val) {
  this.xbee._remoteAT(cmd, this.remote64, this.remote16, val);
}

Node.prototype._onATResponse = function(res) {
  console.log("Node %s got AT_RESPONSE: %s", util.inspect(res));
}

Node.prototype._onDataSampleRx = function(res) {
  this.emit('data_sample', res);  
}

exports.Node = Node;
