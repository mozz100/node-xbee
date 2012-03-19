var xbeesvd = require('./xbee-svd.js');
var xbee;

xbeesvd.open('/dev/ttyO1', function(xb) {
  xbee = xb;
});
