var serialport = require("serialport");
exports.XBee = require("./xbee");

// execute an AT command on the local xbee module
exports.AT = function(cmd, val, cb) {      // e.g. 'ID' or '%V'
  var atc = new xbee.ATCommand();
  atc.setCommand(cmd);
  atc.commandParameter = val;
  b = atc.getBytes();
  serial_xbee.write(b);
  cb_stack
};

// execute an AT command on a remote xbee module
exports.RemoteAt = function(cmd, val, remote64, remote16) {
  var atc = new xbee.RemoteATCommand();
  atc.setCommand(cmd);
  atc.commandParameter = val;
  atc.destination64 = remote64;
  atc.destination16 = remote16;
  b = atc.getBytes();
  serial_xbee.write(b);
}

exports.open = function(port, cb) {
  var xbee = {};
  xbee.serial = new serialport.SerialPort("/dev/ttyUSB0", { 
    parser: exports.XBee.packetParser()
  });

  xbee.serial.on("data", function(data) {
    console.log('XB> ', data.type);    
  });

  exports.AT('ID', false, function(res) {
    xbee.id = res.commandData;
    cb(xbee);
  });
}

/*
// simple example: ATID on local xbee module
AT('ID');
// simple example: query ATD0 on remote xbee module.
var remote64 = [0x00,0x13,0xa2,0x00,0x40,0x7a,0x1f,0x95];  // <-- you'll need to replace this with the 64-bit hex address of your module
var remote16 = [0xff,0xfe]; // <-- put the 16 bit address of remote module here, if known. Otherwise use [0xff, 0xfe]

RemoteAT('D0', null, remote64, remote16);
*/
