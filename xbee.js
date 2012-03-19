var util = require('util');
var async = require('async');
var serialport = require("serialport");
exports.XBee = require("./xbee");

exports.open = function(port, cb) {
  var xbee = {};
  xbee._cb = undefined;

  // execute an AT command on the local xbee module
  xbee.AT = function(cmd, val, cb) {
    var atc = new exports.XBee.ATCommand();
    atc.setCommand(cmd);
    if (typeof val === 'function') cb = val;
    else if (val) atc.commandParameter = val;
    b = atc.getBytes();
    if (xbee._cb == undefined) {
      xbee.serial.write(b);
      if (typeof cb === 'function') xbee._cb = cb;
    } else {
      if (cb) cb(false);
      console.log("ERROR: XBee occupied");
    }
  };
  
  xbee.send = function(payload, remote64, remote16) {
    var trf = new exports.XBee.TransmitRFData();
    trf.destination64 = remote64;
    trf.destination16 = remote16;
    trf.RFData = payload;
    b = trf.getBytes();
    if (true || xbee._cb == undefined) {
      xbee.serial.write(b);
    } else {
      console.log("ERROR: XBee occupied");
    }
  }
  
  xbee.RemoteAT = function(cmd, remote64, remote16, val, cb) {
    var atc = new exports.XBee.RemoteATCommand();
    atc.setCommand(cmd);
    if (typeof val === 'function') cb = val;
    else if (val) atc.commandParameter = val;
    atc.destination64 = remote64;
    atc.destination16 = remote16;
    b = atc.getBytes();
    if (xbee._cb == undefined) {
      xbee.serial.write(b);
      if (typeof cb === 'function') xbee._cb = cb;
    } else {
      if (cb) cb(false);
      console.log("ERROR: XBee occupied");
    }
  }

  xbee.serial = new serialport.SerialPort(port, { 
    parser: exports.XBee.packetParser()
  });

  var at_cb = function(data) {
    //console.log(util.inspect(data));
    if (data.command == "ND") {
      console.log("ATND RES: "+util.inspect(data.node));
    } else if (xbee._cb != undefined) {
      var cb = xbee._cb;
      xbee._cb = undefined;
      cb(data);
    } else {
      console.log("UNHANDLED "+util.inspect(data));
    }
  }
  xbee.serial.on("REMOTE_AT_RESPONSE", at_cb);
  xbee.serial.on("AT_RESPONSE", at_cb);
  xbee.serial.on("RECEIVE_RF_DATA", function(data) {
    console.log("> "+data.data);
  });

  xbee.serial.on("NODE_DENTIFICATION", function(node) {
    console.log(node.nodeIdentifier+" is online");  
    xbee.send("Hey! Nice you're here!\n", node.remote64.dec, node.remote16.dec);
    /*
    if (node.nodeIdentifier === "NODE2") {
      var spam = function() {
        xbee.RemoteAT('ID', node.remote64.dec, node.remote16.dec, function(data) {
          console.log("REMOTE_AT_RESPONSE: "+data.commandStatus);
        });
      }
    } else {
      var spam = function() {
      }
    }
    */
    
  });

  var QF = function(command, f) {
    f = typeof f !== 'undefined' ? f : function(a){return a};
    return function(cb) {
      xbee.AT(command, function(data) {
        cb(!data.commandStatus, f(data.commandData)); 
      });
    }
  }

  var config = {
    panid: QF('ID', exports.XBee.bArr2HexStr),
    identifier: QF('NI', exports.XBee.bArr2Str),
    sourceLow: QF('SL', exports.XBee.bArr2HexStr),
    sourceHigh: QF('SH', exports.XBee.bArr2HexStr)
  };
  
  async.series(config, function(err, results) {
    console.log(results);
    xbee.config = results;
    xbee.AT('ND', function(data) {
      console.log(util.inspect(data));
    });
    //var remote64 = [0x00,0x13,0xa2,0x00,0x40,0x33,0x02,0x87];
    //var remote16 = [0x0e,0xdf]; 
    //var remote64 = [0x00,0x00,0x00,0x00,0x00,0x00,0xff,0xff];
    //var remote16 = [0xff,0xfe]; 
    //xbee.RemoteAT('FR', remote64, remote16, function(data) {
      //xbee.send("Hello World\n", remote64, remote16);
      //console.log(util.inspect(data));
    //});
    //});
    cb(xbee);
  });

}

/*
// execute an AT command on a remote xbee module

/*
// simple example: ATID on local xbee module
AT('ID');
// simple example: query ATD0 on remote xbee module.
var remote64 = [0x00,0x13,0xa2,0x00,0x40,0x7a,0x1f,0x95];  // <-- you'll need to replace this with the 64-bit hex address of your module
var remote16 = [0xff,0xfe]; // <-- put the 16 bit address of remote module here, if known. Otherwise use [0xff, 0xfe]

RemoteAT('D0', null, remote64, remote16);
*/
