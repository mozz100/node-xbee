var Buffer = require('buffer').Buffer;
var util = require('util');

exports.dec2Hex = function(d, padding) {
    var hex = Number(d).toString(16);
    padding = typeof (padding) === "undefined" || padding === null ? padding = 2 : padding;

    while (hex.length < padding) {
        hex = "0" + hex;
    }

    return hex;
}

exports.bArr2HexStr = function(a) {
    var s = '';
    for(i in a) {
      s += exports.dec2Hex(a[i]);
    }
    return s;
}

exports.bArr2Str = function(a) {
  var s = '';
  for(i in a) {
    s += String.fromCharCode(a[i]);
  }
  return s;
}

exports.bArr2Dec = function(a) {
  // given a byte array like [3,21], convert to a decimal value.
  // e.g. [3,21] --> 3 * 256 + 21 = 789
  var r = 0;
  for(var i = 0; i < a.length; i++) {
    var power = a.length - i - 1;
    r += a[i] * Math.pow(256,power);
  }
  return r
}

// module-level variable for storing a frameId.
// Gets incremented by 1 each time it's used, so that you can
// tell which responses relate to which XBee commands
var frameId = 0x00;

function incrementFrameId() {
  // increment frameId and make sure it's <=255
  frameId += 1;
  frameId %= 256;
  return frameId;
}

exports.START_BYTE = 0x7e;              // start of every XBee packet

exports.FT_DATA_SAMPLE_RX = 0x92;       // I/O data sample packet received
exports.FT_AT_COMMAND = 0x08;           // AT command (local)
exports.FT_AT_RESPONSE = 0x88;          // AT response (local)
exports.FT_TX_TRANSMIT_STATUS = 0x8b;   // Status response of transmission
exports.FT_REMOTE_AT_COMMAND = 0x17;    // AT command (to remote radio)
exports.FT_REMOTE_AT_RESPONSE = 0x97;   // AT response (from remote radio)
exports.FT_TRANSMIT_RF_DATA = 0x10;     // Transmit RF data
exports.FT_TRANSMIT_ACKNOWLEDGED = 0x8b; // TX response
exports.FT_RECEIVE_RF_DATA = 0x90;      // RX received
exports.FT_NODE_IDENTIFICATION = 0x95;

exports.DELIVERY_STATES = {
  0x00: "Success",
  0x02: "CCA Failure",
  0x15: "Invalid destination endpoint",
  0x21: "Network ACK Failure",
  0x22: "Not Joined to Network",
  0x23: "Self-addressed",
  0x24: "Address Not Found",
  0x25: "Route Not Found",
  0x74: "Data payload too large"
};

exports.DISCOVERY_STATES = {
  0x00: "No Discovery Overhead",
  0x01: "Address Discovery",
  0x02: "Route Discovery",
  0x03: "Address and Route Discovery"
};

// Bitmasks for I/O pins
var digiPinsByte1 = {
  D10: 4,
  D11: 8,
  D12: 16
};

var digiPinsByte2 = {
  D0: 1,
  D1: 2,
  D2: 4,
  D3: 8,
  D4: 16,
  D5: 32,
  D6: 64,
  D7: 128
};

var analogPins = {
  A0: 1,
  A1: 2,
  A2: 4,
  A3: 8,
  supply: 128
};

// constructor for an outgoing Packet.
var Packet = function() {
  this.frameId = incrementFrameId();
};

// call getBytes to get a JS array of byte values, ready to send down the serial port
Packet.prototype.getBytes = function() {
    // build a JS array to hold the bytes
    var packetdata = [exports.START_BYTE];
    
    // calculate the length bytes.  First, get the entire payload by calling the internal function
    var payload = this.getPayload();

    // least significant length byte is easy
    var len_lsb = payload.length % 256;

    // if payload length is greater than 255, have to calculate the more significant byte...
    if (payload.length > 255) {
      var len_msb =  payload.length >>> 8; 
    } else {
      //...otherwise the MSB is zero
      var len_msb = 0;
    }

    // add the length bytes to our growing packet array
    packetdata.push(len_msb);
    packetdata.push(len_lsb);

    // now calculate checksum, meanwhile pushing each byte from the payload onto the packet array
    var running_total = 0;

    for(var j = 0; j < payload.length; j++) {
      packetdata.push(payload[j]);
      running_total += payload[j];
    }

    checksum = 255 - (running_total % 256);

    // finally append the checksum byte and return the packet as a JS array
    packetdata.push(checksum);
    
    return packetdata;
}

Packet.prototype.getPayload = function() {
  // this function is overridden by subclasses
  return this.payload;
}

exports.Packet = Packet;

// ATCommand is for setting/reading AT registers on the local XBee node.
var ATCommand = function() {
  this.frameId = incrementFrameId();
};
util.inherits(ATCommand, Packet);

ATCommand.prototype.setCommand = function(strCmd) {
  // take the ascii command and save it internally as byte values command0 and command1
  this.command0 = strCmd.charCodeAt(0);
  this.command1 = strCmd.charCodeAt(1);
}

ATCommand.prototype.getPayload = function() {
  // Returns a JS array of byte values
  // which form the payload of an AT command packet.
  // Uses command0, command1 and commandParameter to build the payload.

  // begin with the frame type and frame ID
  var payload = [exports.FT_AT_COMMAND, this.frameId];

  // add two bytes to identify which AT command is being used
  payload.push(this.command0);
  payload.push(this.command1);

  // this.commandParameter can either be undefined (to query an AT register), or an array (to set an AT register)
  if (this.commandParameter) {
    for(var j=0; j<this.commandParameter.length; j++) {
      payload.push(this.commandParameter[j]);
    }
  }

  return payload;
}

exports.ATCommand = ATCommand;

// RemoteATCommand is for setting/reading AT registers on remote XBee nodes.
var RemoteATCommand = function() {
  this.frameId = incrementFrameId();
  this.remoteCommandOptions = 0x02;  // set default command options on creation
};
util.inherits(RemoteATCommand, ATCommand);

RemoteATCommand.prototype.getPayload = function() {
  // Returns a JS array of byte values
  // which form the payload of a remote AT command packet.
  // Uses command0, command1 and commandParameter to build the payload.
  // remoteCommandOptions, destination64 and destination16 are also used.

  // begin with the frame type and frame ID
  var payload = [exports.FT_REMOTE_AT_COMMAND, this.frameId];

  // this.destination64 should be an array of 8 integers. Append it to the payload now.
  for(var i=0; i<8; i++) {
    payload.push(this.destination64[i]);
  }

  // this.destination16 should be an array of 2 integers. Append it to the payload too.
  for(var i=0; i<2; i++) {
    payload.push(this.destination16[i]);
  }

  // remote command options defaults to 0x02 in the constructor
  payload.push(this.remoteCommandOptions);

  // next two bytes identify which AT command is being used
  payload.push(this.command0);
  payload.push(this.command1);

  // this.commandParameter can either be undefined (to query a register), or an array (to set an AT register)
  if (this.commandParameter) {
    for(var j=0; j<this.commandParameter.length; j++) {
      payload.push(this.commandParameter[j]);
    }
  }

  return payload;
}

exports.RemoteATCommand = RemoteATCommand;

var TransmitRFData = function() {
  this.frameId = incrementFrameId();
  this.broadcastRadius = 0x00;     // use maximum hops value by default
  this.options = 0x00;             // see digi docs for more info
}

util.inherits(TransmitRFData, Packet);

TransmitRFData.prototype.getPayload = function() {
  // Returns a JS array of byte values
  // which form an API instruction to transmit RF data to a remote Xbee node.
  // Uses .RFData to build the packet
  // .destination64 and .destination16 are also required.

  // begin with the frame type and frame ID
  var payload = [exports.FT_TRANSMIT_RF_DATA, this.frameId];

  // this.destination64 should be an array of 8 integers. Append it to the payload now.
  for(var i=0; i<8; i++) {
    payload.push(this.destination64[i]);
  }

  // this.destination16 should be an array of 2 integers. Append it to the payload too.
  for(var i=0; i<2; i++) {
    payload.push(this.destination16[i]);
  }

  // broadcastRadius and options default values are set in the constructor
  payload.push(this.broadcastRadius);
  payload.push(this.options);

  if (this.RFData) {
    for(var j=0; j<this.RFData.length; j++) {
      payload.push(this.RFData.charCodeAt(j));

    }
  }

  return payload;
}

exports.TransmitRFData = TransmitRFData;

// Builds Packets out of data received from Serial Port.
exports.packetBuilder = function () {
  var packet = [];   // incoming data buffer saved in closure as a JS array of integers called 'packet'
  var packpos = 999; // this variable is used to remember at which position we are up to within the overall packet
  var packlen = 0;   // used to remember the length of the current packet. 
  var running_total = 0;
  var checksum = -1;

  return function (emitter, buffer) {
    // Collecting data. 
    for(var i=0; i < buffer.length; i++) {
      b = buffer[i]; // store the working byte
      packpos += 1;     

      // Detected start of packet.
      if (b == exports.START_BYTE) {
        packpos = 0;
        packlen = 0;
        running_total = 0;
        checksum = -1;
        packet = [];
      }

      if (packpos == 1) packlen += b << 8; // most significant bit of the length
      if (packpos == 2) packlen += b;   // least significant bit of the length

      if ((packlen > 0) && (packpos > 2)) {
        if (packet.length < packlen) {
          packet.push(b);
          running_total += b;
        } else {
          checksum = b;
        }
      }


      // Packet is complete. Parse & Emit
      if ((packlen > 0) && (packet.length == packlen) && (packpos == packlen + 3)) {
        // There will still be a checksum byte.  Currently this is ignored
        if (!checksum === 255 - (running_total % 256)) {
          console.log("CHECKSUM_MISMATCH"); 
        } else {
          var parser = new PacketParser(packet)
          var json = parser.parse();
          //console.log("P: "+util.inspect(json));
          var event = json.type;
          if (json.ft === exports.FT_TX_TRANSMIT_STATUS || json.ft === exports.FT_AT_RESPONSE || json.ft === exports.FT_AT_REMOTE_RESPONSE) {
            event += "_"+json.frameId;
          }
          if (json.type === "UNKNOWN")
            console.log("FRAME: %s (%s). EVT: %s RAW:[%s]", json.ft, json.type, event, exports.bArr2Str(json.rawData));
          emitter.emit(event, json);
        }
      }
    }
  };
}

// Packet Parser Class. Used to parse packets if they are known
var PacketParser = function(p) {
  this.json = {
    ft: p.splice(0,1)[0],
  }

  // Used as pointer to the object data is parsed into
  this.write = this.json;
  this.payload = p;
}

PacketParser.prototype.parse = function() {
  if (this.knownFrames[this.json.ft]) {
    this.json.type = this.knownFrames[this.json.ft].type;
    this.knownFrames[this.json.ft].parse(this);
  } else {
    this.json.type = "UNKNOWN";
  }
  return this.json;
}

PacketParser.prototype.readAddr = function(name, length) {
  var dec = this.payload.splice(0, length);
  this.write[name] = { dec: dec, hex: exports.bArr2HexStr(dec) }
  return this;
}

PacketParser.prototype.readByte = function(name, length) {
  if (typeof length === 'number')
    this.write[name] = this.payload.splice(0,length);
  else this.write[name] = this.payload.splice(0,1)[0];
  return this;
}

PacketParser.prototype.readAddr64 = function(name) {
  return this.readAddr(name, 8);
}

PacketParser.prototype.readAddr16 = function(name) {
  return this.readAddr(name, 2);
}

PacketParser.prototype.readString = function(name, length) {
  this.write[name] = "";
  if (typeof length === 'number') {
    for (var i = 0; i < length; i++)
      this.write[name] += String.fromCharCode(this.payload.splice(0,1)[0]);
  } else {
    while(this.payload[0] != 0x00) {
      this.write[name] += String.fromCharCode(this.payload.splice(0,1)[0]);
    }
    this.payload.splice(0,1); // Read 0x00 away 
  }
  return this;
}

PacketParser.prototype.collectPayload = function(name) {
  this.write[name] = this.payload.splice(0);
  return this;
}

PacketParser.prototype.knownFrames = {
  0x95: {
    type: "NODE_IDENTIFICATION",
    parse: function(parser) {
      parser
        .readAddr64('sender64')
        .readAddr16('sender16')
        .readByte('recieveOptions');
      parser.json.node = {};
      parser.write = parser.json.node;
      parser
        .readAddr16('remote16')
        .readAddr64('remote64')
        .readString('id')
        .readAddr16('remoteParent16')
        .readByte('deviceType')
        .readByte('sourceEvent');
    }
  },
  0x8b: {
    type: "TX_TRANSMIT_STATUS",
    parse: function(parser) {
      parser
        .readByte('frameId')
        .readAddr16('remote16')
        .readByte('transmitRetryCount')
        .readByte('deliveryStatus')
        .readByte('discoveryStatus')
    }
  },
  0x88: {
    type: "AT_RESPONSE",
    parse: function(parser) {
      parser
        .readByte('frameId')
        .readString('command', 2)
        .readByte('commandStatus')
      if (parser.json.command == 'ND') {
        parser.json.node = {};
        parser.write = parser.json.node;
        parser
          .readAddr16('remote16')
          .readAddr64('remote64')
          .readString('id')
          .readAddr16('remoteParent16')
          .readByte('deviceType')
          .readByte('sourceEvent')
          .readByte('status');
      } else {
        parser.collectPayload('commandData')
      }
    }
  },
  0x97: {
    type: "REMOTE_AT_RESPONSE",
    parse: function(parser) {
      parser
        .readByte('frameId')
        .readAddr16('remote16')
        .readAddr64('remote64')
        .readString('command', 2)
        .readByte('commandStatus')
        .collectPayload('commandData');
    }
  },
  0x90: {
    type: "RECEIVE_RF_DATA",
    parse: function(parser) {
      parser
        .readAddr64('remote64')
        .readAddr16('remote16')
        .readByte('receiveOptions')
        .collectPayload('rawData');
    }
  },
  0x92: {
    type: "DATA_SAMPLE_RX",
    parse: function(parser) {
      parser
        .readAddr64('remote64')
        .readAddr16('remote16')
        .readByte('receiveOptions')
        .readByte('numSamples')
        .readByte('digitalChanelMask', 2)
        .readByte('analogChannelMask')
      if (parser.json.digitalChannelMask[0] + parser.json.digitalChannelMask[1] > 0)
        parser.readByte('digitalSamples',2);
      if (parser.json.analogChannelMask > 0)
        parser.collectPayload('analogSamples');
      // skip formatting data for now
    }
  }
}
