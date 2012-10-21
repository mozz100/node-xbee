module.exports = function (device) {
  var delimiter = "\r";
  function DataParser(device) {
    this.device = device;
    this.buffer = "";
  }
  DataParser.prototype.parse = function(data) {
    this.buffer += data;
    var split = this.buffer.indexOf(delimiter);
    while (split > -1) {
      this.device.emit('data', this.buffer.slice(0,split));
      this.buffer = this.buffer.slice(split+delimiter.length);
      split = this.buffer.indexOf(delimiter);
    }
  }

  return new DataParser(device);
}
