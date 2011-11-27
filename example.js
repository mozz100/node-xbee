var rsp = require("serialport");
var xbee = require("xbee");
var SerialPort = rsp.SerialPort; // localize object constructor

// connect to xbee module on /dev/ttyUSB0 using serialport.
// Pass xbee.packetParser as the parser - that's it
var serial_xbee = new SerialPort("/dev/ttyUSB0", { 
  parser: xbee.packetParser()
});

// listen for incoming xbee data
serial_xbee.on("data", function(data) {
  console.log('xbee data received:', data.type);    
});

// execute an AT command on the local xbee module
function AT(cmd, val) {      // e.g. 'ID' or '%V'
  var atc = new xbee.ATCommand();
  atc.setCommand(cmd);
  atc.commandParameter = val;
  b = atc.getBytes();
  serial_xbee.write(b);
  //console.log('Wrote bytes to serial port', b);
};

// simple example: ATID on local xbee module
AT('ID');

// execute an AT command on a remote xbee module
function RemoteAT(cmd, val, remote64, remote16) {
  var atc = new xbee.RemoteATCommand();
  atc.setCommand(cmd);
  atc.commandParameter = val;
  atc.destination64 = remote64;
  atc.destination16 = remote16;
  b = atc.getBytes();
  serial_xbee.write(b);
  //console.log('Wrote bytes to serial port', b);
}

// simple example: query ATD0 on remote xbee module.
var remote64 = [0x00,0x13,0xa2,0x00,0x40,0x7a,0x1f,0x95];  // <-- you'll need to replace this with the 64-bit hex address of your module
var remote16 = [0xff,0xfe]; // <-- put the 16 bit address of remote module here, if known. Otherwise use [0xff, 0xfe]

RemoteAT('D0', null, remote64, remote16);
