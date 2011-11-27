This module lets you bridge the real world to Node.js.  Connect to sensors, robots, turn things on and off, take remote measurements.  In fact if you find a creative use for this stuff, let me know!  I'd be proud to hear of it being taken advantage of.

(made up Javascript code to get your imagination going)

    frontdoor.on("open", function() {
      if (alarm.state == "on") {
        alarm.sound();
        hounds.release();
      } else {
        lights.switchOn();
        voice.speak("Welcome home");
      }
    });

Background
==========

[Digi's xbee modules](http://www.digi.com/xbee) are good for quickly building low power wireless networks.

They can be connected to a computer over RS232 and communicated on using a standard serial port.

Even easier, with something like the [XBee USB Explorer](http://www.sparkfun.com/products/8687) by SparkFun, you can connect to them easily over USB.

This work is inspired by:

* voodootikigod's [serialport module](https://github.com/voodootikigod/node-serialport) (in fact you're going to need this to use this package)
* "[Building Wireless Sensor Networks](http://shop.oreilly.com/product/9780596807740.do)" by Rob Faludi

Setup
=====

I have my xbee coordinator radio connected to the computer running Node.  Crucially, the coordinator is in xbee's API mode - this is required to allow you to send remote instructions, and so on.

My remote xbee network modules send periodic measurements and I can push them to web browsers, save them in a database, etc.

I can also use this library to send remote commands and query remote xbee modules.  For instance, setting a digital output on a remote module could turn a light on, or a motor, or a laser beam - up to you!

How To Use
==========

Like node-serialport, using this is "pretty easy because it is pretty basic. It provides you with the building block to make great things, it is not a complete solution - just a cog in the (world domination) machine."

To Install
----------

You'll need serialport as well (this module doesn't depend on it, but it provides a parser so this is the intended use pattern)

    npm install serialport
    npm install xbee

To Use
------

Open a serial port and give the xbee parser as an option:

    var serial_xbee = new SerialPort("/dev/ttyUSB0", { 
      parser: xbee.packetParser()
    });

Then listen for incoming xbee packets like this:

    serial_xbee.on("data", function(data) {
      console.log('xbee data received:', data.type);    
    });

(the __data__ object passed has lot more packet-type-dependent properties)

Send remote AT commands (e.g. query remote module, or "release the hounds"):

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

See __example.js__ for a full working example (you'll need to use your own xbee IDs, though).

Licence
-------

<a rel="license" href="http://creativecommons.org/licenses/by-sa/2.0/uk/"><img alt="Creative Commons License" style="border-width:0" src="http://i.creativecommons.org/l/by-sa/2.0/uk/88x31.png" /></a><br />This work by <span xmlns:cc="http://creativecommons.org/ns#" property="cc:attributionName">Richard Morrison</span> is licensed under a <a rel="license" href="http://creativecommons.org/licenses/by-sa/2.0/uk/">Creative Commons Attribution-ShareAlike 2.0 UK: England &amp; Wales License</a>.<br />Based on a work at <a xmlns:dct="http://purl.org/dc/terms/" href="https://github.com/mozz100/node-xbee" rel="dct:source">github.com</a>.
