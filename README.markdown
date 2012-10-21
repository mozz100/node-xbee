A more high level fork of Richard Morrison's node-xbee.

Example
=======
If you pass no parser function to the XBee() constructor, nodes will emit each data packet that they receive as a 'data' event. See simple-parser.js for a basic parser that splits on \r, and is easily adapted if you wish to use \n or some other delimiter.  The simple parser will merge frames and emit them split by your delimiter (so if you wonder why no data is emitted, make sure you use the right delimiter!).

Set things up like this, substituting in paramaters that match your Xbee network:

```javascript
var util = require('util');
var XBee = require('svd-xbee').XBee;

// Replace with your xbee's UART location and correct baud rate (if you omit baudrate, the code assumes your xbee talks at 57600).
var xbee = new XBee({port: '/dev/tty01', baudrate:9600});

xbee.on("configured", function(config) {
  console.log("XBee Config: %s", util.inspect(config));
});

xbee.on("node", function(node) {
  console.log("Node %s connected", node.id);

  node.on("data", function(data) {
    console.log("%s: %s", node.id, util.inspect(data));
  });

});
```
Then, you can run:

```javascript
xbee.init();
```

and you should start to see things logged back to your console.

Background
==========

Note that this readme is still mostly copied from the original module!

[Digi's xbee modules](http://www.digi.com/xbee) are good for quickly building low power wireless networks.

They can be connected to a computer over RS232 and communicated on using a standard serial port.

Even easier, with something like the [XBee USB Explorer](http://www.sparkfun.com/products/8687) by SparkFun, you can connect to them easily over USB.

This work is inspired by:

* voodootikigod's [serialport module](https://github.com/voodootikigod/node-serialport) (in fact you're going to need this to use this package)
* "[Building Wireless Sensor Networks](http://shop.oreilly.com/product/9780596807740.do)" by Rob Faludi

Setup
=====

I have my xbee coordinator radio connected to the computer running Node.  Crucially, the coordinator is in xbee's API mode 2 - this is required to allow you to send remote instructions, and so on, and uses escaping to improve reliability.

My remote xbee network modules send periodic measurements and I can push them to web browsers, save them in a database, etc.

I can also use this library to send remote commands and query remote xbee modules.  For instance, setting a digital output on a remote module could turn a light on, or a motor, or a laser beam - up to you!

Installation
============

    npm install svd-xbee

Licence
=======

This work is based on the works of Richard Morrison
<a rel="license" href="http://creativecommons.org/licenses/by-sa/2.0/uk/"><img alt="Creative Commons License" style="border-width:0" src="http://i.creativecommons.org/l/by-sa/2.0/uk/88x31.png" /></a><br />This work by <span xmlns:cc="http://creativecommons.org/ns#" property="cc:attributionName">Richard Morrison</span> is licensed under a <a rel="license" href="http://creativecommons.org/licenses/by-sa/2.0/uk/">Creative Commons Attribution-ShareAlike 2.0 UK: England &amp; Wales License</a>.<br />Based on a work at <a xmlns:dct="http://purl.org/dc/terms/" href="https://github.com/mozz100/node-xbee" rel="dct:source">github.com</a>.
