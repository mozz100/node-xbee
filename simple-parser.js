module.exports = function (device) {
  function DataParser(device) {
    this.device = device;
    this.buffer = "";
  }

  DataParser.prototype.parse = function(data) {
    this.buffer += data;
    var split = this.buffer.indexOf('\r\n');
    while (split > -1) {
      this.device.emit('data', this.buffer.slice(0,split));
      this.buffer = this.buffer.slice(split+2);
      split = this.buffer.indexOf('\r\n');
    }
  }

  return new DataParser(device);
}
