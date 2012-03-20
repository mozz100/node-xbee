var Buffer = require('buffer').Buffer;
var sys = require('util');

// TODO: CHAIN PARSING

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

exports.frameTypes = {
  0x92 : {
    name: "DATA_SAMPLE_RX",
  },
  0x08 : {
    name: "AT_COMMAND",
  },
  0x88 : {
    name: "AT_RESPONSE",
  },
  0x17 : {
    name: "REMOTE_AT_COMMAND",
  },
  0x97 : {
    name: "REMOTE_AT_RESPONSE",
  },
  0x10 : {
    name: "TRANSMIT_RF_DATA",
  },
  0x8b : {
    name: "TRANSMIT_ACKNOWLEDGED",
  },
  0x90 : {
    name: "RECEIVE_RF_DATA",
  },
  0x95 : {
    name: "NODE_IDENTIFICATION",
  },
}
// Frame Types
exports.FT_DATA_SAMPLE_RX = 0x92;       // I/O data sample packet received
exports.FT_AT_COMMAND = 0x08;           // AT command (local)
exports.FT_AT_RESPONSE = 0x88;          // AT response (local)
exports.FT_REMOTE_AT_COMMAND = 0x17;    // AT command (to remote radio)
exports.FT_REMOTE_AT_RESPONSE = 0x97;   // AT response (from remote radio)
exports.FT_TRANSMIT_RF_DATA = 0x10;     // Transmit RF data
exports.FT_TRANSMIT_ACKNOWLEDGED = 0x8b; // TX response
exports.FT_RECEIVE_RF_DATA = 0x90;      // RX received

exports.FT_NODE_IDENTIFICATION = 0x95;

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

// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// ~~~~~~~~~~~~~~~~~~~~ OUTGOING XBEE PACKETS ~~~~~~~~~~~~~~~~~~~~
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

// ATCommand is for setting/reading AT registers on the local XBee node.
var ATCommand = function() {
  this.frameId = incrementFrameId();
};
sys.inherits(ATCommand, Packet);

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
sys.inherits(RemoteATCommand, ATCommand);

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

sys.inherits(TransmitRFData, Packet);

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

  // this.commandParameter can either be undefined (to query a register), or an array (to set an AT register)
  if (this.RFData) {
    for(var j=0; j<this.RFData.length; j++) {
      payload.push(this.RFData.charCodeAt(j));

    }
  }

  return payload;
}

exports.TransmitRFData = TransmitRFData;


// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
// ~~~~~~~~~~~~~~~~~~~~ INCOMING XBEE PACKETS ~~~~~~~~~~~~~~~~~~~~
// ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

exports.packetParser = function () {
  // A function which can be used with the 'serialport' npm package
  // and a XBee radio in API mode.
  // It builds a JS array of integers as data is received, and when the
  // array represents a complete XBee packet, it emits it as a 'data' event,
  // passing a JS object (as translated by packetToJS) instead of a load of numbers.

  // incoming data buffer saved in closure as a JS array of integers called 'packet'
  var packet = [];
  var packpos = 999; // this variable is used to remember at which position we are up to within the overall packet
  var packlen = 0;   // used to remember the length of the current packet.  XBee API packets have two length bytes immediately after the start byte

  return function (emitter, buffer) {
    // Collecting data. 'buffer' needs to be run through - it contains bytes received from the serial port
    // which may or may not represent an entire XBee packet.

    for(var i=0; i < buffer.length; i++) {
      b = buffer[i];    // store the working byte
      packpos += 1;     

      if (b == exports.START_BYTE) {
        // Detected start of packet.
        // exports.START_BYTE = 126, the start of a zigbee packet i.e. 0x7e
        packpos = 0;
        packlen = 0;  // length of packet is unknown, as yet.
        packet = [];  // store the bytes as they come in.  Don't keep start byte or length bytes
      }
      if (packpos == 1) {
        // most significant bit of the length
        packlen += b<<8;
      }
      if (packpos == 2) {
        // least significant bit of the length
        packlen += b;
      }

      // for all other bytes, collect them onto the end of our growing 'packet' array
      if ((packlen > 0) && (packpos > 2) && (packet.length < packlen)) {
        packet.push(b);
      }

      // emit the packet when it's fully built.  packlen + 3 = position of final byte
      if ((packlen > 0) && (packet.length == packlen) && (packpos == packlen + 3)) {
        // translate the packet into a JS object before emitting it
        var json = packetToJS(packet);
        console.log("F: "+json.ft);
        emitter.emit(json.ft, json);
      }

      // there will still be a checksum byte.  Currently this is ignored
      if ((packlen > 0) && (packet.length == packlen) && (packpos > packlen + 3)) {
        // ignore checksum for now
      }
    }
  };
}

function packetToJS(packet) {
  // given an array of byte values, return a JS object representing the packet
  // the array of bytes excludes the start bit and the length bits (these are not collected by the serial parser funciton)

  // So, the first byte in the packet is the frame type identifier.
  var json = {
    ft: exports.frameTypes.hasOwnProperty(packet[0]) ? exports.frameTypes[packet[0]].name : packet[0]
  };

  if (packet[0] == exports.FT_NODE_IDENTIFICATION) {
    json.sender64 = {dec: packet.slice(1,9),  hex: exports.bArr2HexStr(packet.slice(1,9))};
    json.sender16 = {dec: packet.slice(9,11), hex: exports.bArr2HexStr(packet.slice(9,11))};
    json.recieveOptions = packet[11];
    json.remote16 = {dec: packet.slice(12,14), hex: exports.bArr2HexStr(packet.slice(12,14))};
    json.remote64 = {dec: packet.slice(14,22),  hex: exports.bArr2HexStr(packet.slice(14,22))};
    json.id = "";
    var ni_length = 0;
    while (packet[22+ni_length] != 0x00) {
      json.id += String.fromCharCode(packet[22+ni_length]);
      ni_length += 1;
    }
    var offset = 22+ni_length+1;
    json.remoteParent16 = {dec: packet.slice(offset,offset+2),  hex: exports.bArr2HexStr(packet.slice(offset,offset+2))};
    json.deviceType = packet[offset+2];
    json.sourceEvent = packet[offset+3];
    // skip digi  application profile & manufacturer id
    json.payload = packet.splice(offset);
  } else if (packet[0] == exports.FT_AT_RESPONSE) {
    json.frameId = packet[1];
    json.command = String.fromCharCode(packet[2]) + String.fromCharCode(packet[3]);
    json.commandStatus = (packet[4] == 0) ? 'OK' : packet[4];
    if (json.command == 'ND') {
      json.node = {};
      json.node.remote16 = {dec: packet.slice(5,7), hex: exports.bArr2HexStr(packet.slice(5,7))};
      json.node.remote64 = {dec: packet.slice(7,15),  hex: exports.bArr2HexStr(packet.slice(7,15))};
      json.node.id = "";
      var ni_length = 0;
      while (packet[15+ni_length] != 0x00) {
        json.node.id += String.fromCharCode(packet[15+ni_length]);
        ni_length += 1;
      }
      var offset = 15+ni_length+1;
      json.node.remoteParent16 = {dec: packet.slice(offset,offset+2),  hex: exports.bArr2HexStr(packet.slice(offset,offset+2))};
      json.node.deviceType = packet[offset+2];
      json.node.sourceEvent = packet[offset+3];
      json.status = packet[offset+4];
      // skip status, digi application profile & manufacturer id
    } else {
      json.commandData = packet.slice(5);
    }
  } else if (packet[0] == exports.FT_REMOTE_AT_RESPONSE) {
    json.frameId = packet[1];
    json.remote64 = {dec: packet.slice(2,10),  hex: exports.bArr2HexStr(packet.slice(2,10))};
    json.remote16 = {dec: packet.slice(10,12), hex: exports.bArr2HexStr(packet.slice(10,12))};
    json.command = String.fromCharCode(packet[12]) + String.fromCharCode(packet[13]);
    json.commandStatus = (packet[14] == 0) ? 'OK' : packet[14];
    json.commandData = packet.slice(15);
  } else if (packet[0] == exports.FT_RECEIVE_RF_DATA) {
    json.remote64 = {dec: packet.slice(1,9),  hex: exports.bArr2HexStr(packet.slice(1,9))};
    json.remote16 = {dec: packet.slice(9,11), hex: exports.bArr2HexStr(packet.slice(9,11))};
    json.receiveOptions = packet[11];
    json.data = "";
    var raw_data = packet.slice(12);
    for(i in raw_data) {
      json.data += String.fromCharCode(raw_data[i])
    }
  } else if (packet[0] == exports.FT_DATA_SAMPLE_RX) {
    json.remote64 = {dec: packet.slice(1,9),  hex: exports.bArr2HexStr(packet.slice(1,9))};
    json.remote16 = {dec: packet.slice(9,11), hex: exports.bArr2HexStr(packet.slice(9,11))};
    json.receiveOptions = packet[11];
    json.numSamples = packet[12];     // apparently always set to 1
    json.digitalChannelMask = packet.slice(13,15);
    json.analogChannelMask = packet[15];
    // Bit more work to do on an I/O data sample.
    // First check s.digitalChannelMask - are there any digital samples?
    if (json.digitalChannelMask[0] + json.digitalChannelMask[1] > 0) {
      // digital channel mask indicates that digital samples are present, so they
      // are in the bytes 16 and 17.
      json.digitalSamples = packet.slice(16,18);
      // Now check whether any analog samples are present
      if (json.analogChannelMask > 0) {
        json.analogSamples = packet.slice(18);
      }
    } else {
      // no digital samples.  There might still be analog samples...
      if (json.analogChannelMask > 0) {
        json.analogSamples = packet.slice(16);
      }
    }

    // translate digital samples into JS for easier handling
    json.samples = {}
    if (json.digitalChannelMask[0] + json.digitalChannelMask[1] > 0) {  // if digital samples present,
      // run through the first bitmask for digital pins, i.e. digiPinsByte1
      for (x in digiPinsByte1) {
        // On first iteration, for example, x = 'D10', digiPinsByte1[x] = 4.
        // OK.  So, is there a sample for this pin?  Check the digital channel mask.
        if (json.digitalChannelMask[0] & digiPinsByte1[x]) {
          // There is a sample for this pin.  So, AND the sample byte and the bitmask,
          // and turn the result into a boolean.
          // On the first iteration, for example, this sets s['D10'] = 1
          // if the bitwise AND of the first byte of the digital sample with 4 is > 0
          json.samples[x] = ((json.digitalSamples[0] & digiPinsByte1[x]) > 0) ? 1 : 0;
        }
      }
      // do the same thing for the second load of digital inputs
      for (x in digiPinsByte2) {
        if (json.digitalChannelMask[1] & digiPinsByte2[x]) {
          json.samples[x] = ((json.digitalSamples[1] & digiPinsByte2[x]) > 0) ? 1 : 0;
        }
      }
    }

    // Also translate analog samples into JS
    // The analog channel mask indicates which pins are enabled as analog channels.
    if (json.analogChannelMask > 0) {
      var sampleIndex = 0;
      for (x in analogPins) {
        // on first iteration, for example, x = 'A0', analogPins[x] = 1
        if (json.analogChannelMask & analogPins[x]) {
          json.samples[x] = 256*json.analogSamples[sampleIndex*2]+json.analogSamples[1+sampleIndex*2];
          sampleIndex += 1;
        }
      }
    }
  } else {
    json.payload = packet.slice(1);
  }

  return json;  
}
