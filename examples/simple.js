var util = require('util');
var XBee = require('../xbee.js').XBee;
var Parser = require('svd-http-parser');

// Replace with your xbee's UART location
//var xbee = new XBee('/dev/ttyO1');
var xbee = new XBee('/dev/ttyO1', Parser);

xbee.on("configured", function(config) {
  console.log("XBee Config: %s", util.inspect(config));
});

xbee.on("node", function(node) {
  console.log("Node %s connected", node.id);

  node.on("/register", function(data) {
    //node.send("pong");
    console.log("%s: %s", node.id, util.inspect(data.payload)); 
  });

});
