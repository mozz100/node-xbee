var util = require('util');
var EventEmitter = require('events').EventEmitter;
var api = require("./lib/xbee-api.js");
var serialport = require("serialport");
var async = require('async');
var os = require('os');

var C = api.Constants;

function XBee(options, data_parser) { 
  EventEmitter.call(this);

  // Option Parsing
  if (typeof options === 'string') {
    this.options = { port: options };
  } else {
    this.options = options;
  }

  this.data_parser = data_parser || options.data_parser || undefined;

  this.use_heartbeat = options.use_heartbeat || false;
  this.heartbeat_packet = options.heartbeat_packet || '```';
  this.heartbeat_timeout = options.heartbeat_timeout || 8000;

  // How long (in ms) shall we wait before deciding that a transmit hasn't been successful?
  this.transmit_status_timeout = options.transmit_status_timeout || 1000;

  if (options.api_mode) api.api_mode = options.api_mode;

  // Current nodes
  this.nodes = {};
}

util.inherits(XBee, EventEmitter);

XBee.prototype.init = function(cb) {
  var self = this;
  // Serial connection to the XBee
  self.serial = new serialport.SerialPort(self.options.port, {
    baudrate: self.options.baudrate || 57600,
    databits: 8,
    stopbits: 1,
    parity: 'none',
    parser: api.packetBuilder()
  });

  self.serial.on("open", function() {
    self.configure.bind(self)(cb);
  });

  var exit = function() { 
    self.serial.close(function(err) {
      if (err) console.log("Error closing port: "+util.inspect(err));
      process.exit();
    });
  }
  
  if (os.platform() !== 'win32') {
    process.on('SIGINT', exit);
  }


  /* Frame-specific Handlers */

  // Whenever a node is identified (on ATND command).
  self._onNodeIdentification = function(data) {
    var node = data.node;
    if (!self.nodes[node.remote64.hex]) {
      self.nodes[node.remote64.hex] = new Node(self, node, self.data_parser);
      self.emit("node", self.nodes[node.remote64.hex]);
    } else {
      // update 16-bit address, as it may change during reconnects.
      self.nodes[node.remote64.hex].remote16 = node.remote16;
      self.nodes[node.remote64.hex].id = node.id;
      self.nodes[node.remote64.hex].emit("reconnect");
    }
  }

  // AT Command Responses from remote AT Commands
  self._onRemoteCommandResponse = function(res) {
    if (self.nodes[res.remote64.hex]) {
      self.nodes[res.remote64.hex]._onRemoteCommandResponse(res);
    } else {
      console.log("Unhandled REMOTE_AT_RESPONSE: %s", util.inspect(res));
    }
  }

  // Messages
  self._onReceivePacket = function(data) {
    if (!self.nodes[data.remote64.hex]) {
      var _data = { node:data };
      _data.node.id = "UNKNOWN";
      self._onNodeIdentification(_data);
      console.log("ERROR: Data from unknown node!");
    }
    self.nodes[data.remote64.hex]._onReceivePacket(data);
  }

  // Data samples (from XBee's I/O)
  self._onDataSampleRx = function(data) {
    if (self.nodes[data.remote64.hex]) {
      self.nodes[data.remote64.hex]._onDataSampleRx(data);
    } else {
      console.log("ERROR: Data sample from unknown node!");
    }
  }

  self.serial.on(C.FRAME_TYPE.REMOTE_COMMAND_RESPONSE,  self._onRemoteCommandResponse);
  self.serial.on(C.FRAME_TYPE.NODE_IDENTIFICATION,      self._onNodeIdentification);
  self.serial.on(C.FRAME_TYPE.ZIGBEE_RECEIVE_PACKET,    self._onReceivePacket);
  self.serial.on(C.FRAME_TYPE.ZIGBEE_IO_DATA_SAMPLE_RX, self._onDataSampleRx);
  
  self._queue = async.queue(function(task, callback) {
    async.series(task.packets, function(err, data) {
      if (typeof task.cb === 'function') task.cb(err, data[data.length-1]);
      callback();
    });
  }, 1);
}

XBee.prototype.configure = function(_done_cb) {
  var self = this;
  /*
  self._ATCB('ID', undefined, function(data) {
    console.log("ID: "+util.inspect(data));
  });
  */
  // Returns a function that initiates an AT command to
  // query a configuration parameter's value. 
  // To be passed to an async.parallel.
  var QF = function(command, val, f) { // Format the result using f
    f = typeof f !== 'undefined' ? f : function(a){return a};
    return function(cb) {
      self._AT(command, val, function(err, data) {
        cb(err, f(data.commandData)); 
      });
    }
  }

  var config = {
    panid:             QF('ID', undefined, api.bArr2HexStr),
    id:                QF('NI', undefined, api.bArr2Str),
    sourceLow:         QF('SL', undefined, api.bArr2HexStr),
    sourceHigh:        QF('SH', undefined, api.bArr2HexStr),
    //maxPayloadSize:    QF('NP', api.bArr2HexStr), // Returns ERROR :/
    setNodeDiscoveryTime: QF('NT', [0x96], function(a) { return "NT SET: "+api.bArr2Dec(a); }),
    nodeDiscoveryTime: QF('NT', undefined, function(a) { return 100 * api.bArr2Dec(a); })
  };
  
  var done = function(err, results) {
    if (err) {
      self.emit("error", new Error("Failure to configure XBee module: "+util.inspect(err)));
      if (typeof _done_cb === 'function') _done_cb(err);
    }
    self.config = results;
    self.emit("configured", self.config);
    if (typeof _done_cb === 'function') _done_cb(null, self.config);
    self.discover();
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
  var self = this;
  // todo: could be nicer, pass _onNodeIdentification to _AT - but it's "once"...
  var cbid = self._AT('ND');
  self.serial.on(cbid, self._onNodeIdentification);
  setTimeout(function() {
    if (typeof cb === 'function') cb(); 
    self.removeAllListeners(cbid);
  }, self.config.nodeDiscoveryTime || 6000);
}

XBee.prototype.broadcast = function(data, cb) {
  var remote64 = [0x00,0x00,0x00,0x00,0x00,0x00,0xff,0xff];
  var remote16 = [0xff,0xfe]; 
  this._send(data, remote64, remote16, cb);
}

XBee.prototype._makeTask = function(packet) {
  var self = this;
  return function Writer(cb) {
    //console.log("<<< "+util.inspect(packet.data));
    //console.log("<<< "+packet.data);

    var timeout = setTimeout(function() {
      cb({ msg: "Never got Transmit status from XBee" });
    }, self.transmit_status_timeout );
    self.serial.write(packet.data, function(err, results) {
      if (err) {
        cb(err);
      } else {
        //console.log(util.inspect(packet.data));
        if (results != packet.data.length) return cb(new Error("Not all bytes written"));
        self.serial.once(packet.cbid, function(data) {
          //console.log("Got Respones: "+packet.cbid);
          clearTimeout(timeout);
          var error = null;
          if (data.commandStatus && data.commandStatus != C.COMMAND_STATUS.OK) {
            error = C.COMMAND_STATUS[data.commandStatus];
          } else if (data.deliveryStatus && data.deliveryStatus != C.DELIVERY_STATUS.SUCCESS) {
            error = C.DELIVERY_STATUS[data.deliveryStatus];
          }
          cb(error, data);
        });
      }
    });
  };
}

XBee.prototype._send = function(data, remote64, remote16, _cb) {
  var packets = [];
  while (data.length > 0) {
    var frame = new api.TransmitRFData();
    frame.destination64 = remote64.dec;
    frame.destination16 = remote16.dec;
    frame.RFData = data.slice(0, C.MAX_PAYLOAD_SIZE);
    data = data.slice(C.MAX_PAYLOAD_SIZE);
    packets.push(this._makeTask({
      data: frame.getBytes(),
      cbid: C.FRAME_TYPE.ZIGBEE_TRANSMIT_STATUS + C.EVT_SEP + frame.frameId
    }));
  }

  this._queue.push({ packets:packets, cb:_cb });
}

XBee.prototype._AT = function(cmd, val, _cb) {
  // val parameter is optional
  if (typeof val === 'function') {
    _cb = val;
    val = undefined;
  }

  var frame = new api.ATCommand();
  frame.setCommand(cmd);
  frame.commandParameter = val;
  var cbid = C.FRAME_TYPE.AT_COMMAND_RESPONSE + C.EVT_SEP + frame.frameId;
  var packet = [this._makeTask({
    data: frame.getBytes(),
    cbid: cbid
  })];
  this._queue.push({ packets:packet, cb:_cb });
  return cbid;
}


XBee.prototype._remoteAT = function(cmd, remote64, remote16, val, _cb) {
  // val parameter is optional
  if (typeof val === 'function') {
    _cb = val;
    val = undefined;
  }

  var frame = new api.RemoteATCommand();
  frame.setCommand(cmd);
  frame.commandParameter = val;
  frame.destination64 = remote64.dec;
  frame.destination16 = remote16.dec;
  var cbid = C.FRAME_TYPE.REMOTE_COMMAND_RESPONSE + C.EVT_SEP + frame.frameId;
  var packet = [this._makeTask({
    data: frame.getBytes(),
    cbid: cbid
  })];
  this._queue.push({ packets:packet, cb:_cb });
  return cbid;
}

exports.XBee = XBee;

function Node(xbee, params, data_parser) {
  EventEmitter.call(this);
  this.xbee = xbee;
  this.id = params.id;
  this.remote16 = params.remote16;
  this.remote64 = params.remote64;
  this.buffer = "";
  if (typeof data_parser === 'function')
    this.parser = data_parser(this);
  this.timeout = {};
  this.connected = true;
  this.refreshTimeout();
}

util.inherits(Node, EventEmitter);

Node.prototype.timeoutOccured = function() {
  this.connected = false;
  this.emit('disconnect');
}

Node.prototype.refreshTimeout = function() {
  clearTimeout(this.timeout);
  this.timeout = setTimeout(this.timeoutOccured.bind(this), this.xbee.heartbeat_timeout);
  if (!this.connected) {
    this.connected = true;
    // todo other stuff
  }
}

Node.prototype.send = function(data, cb) {
  this.xbee._send(data, this.remote64, this.remote16, cb);
}

Node.prototype._onReceivePacket = function(data) {
  // TODO: should be buffer all along!
  var packet = new Buffer(data.rawData).toString('ascii');
  if (this.xbee.use_heartbeat && packet === this.xbee.heartbeat_packet)
    this.refreshTimeout();
  else if (this.parser !== undefined)
    this.parser.parse(packet);
  else
    this.emit('data', packet);
}

Node.prototype.ATCommand = function(cmd, val, cb) {
  // val parameter is optional
  if (typeof val === "function") {
    // use val as the callback in this case
    this.xbee._remoteAT(cmd, this.remote64, this.remote16, val);
  } else {
    this.xbee._remoteAT(cmd, this.remote64, this.remote16, val, cb);
  }

}

/*
Node.prototype._onATResponse = function(res) {
  console.log("Node %s got AT_RESPONSE: %s", util.inspect(res));
}

Node.prototype._onDataSampleRx = function(res) {
  this.emit('data_sample', res);  
}
*/

exports.Node = Node;
