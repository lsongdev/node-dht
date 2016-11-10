const _ = require('./util');
const EventEmitter = require('events');

class Node extends EventEmitter {
  static createNodes(data) {
    const nodes = [];
    for (var i = 0; i + 26 <= data.length; i += 26) {
      const id = data.slice(i, i + 20);
      nodes.push(new Node({
        id,
        address: [
          data[i + 20],
          data[i + 21],
          data[i + 22],
          data[i + 23]].join('.'),
        port: data.readUInt16BE(i + 24)
      }));
    }
    return nodes;
  }
  static encode(node) {
    try {
      return Buffer.concat([
        node.id,
        Buffer.from(node.address.split('.').map(x => parseInt(x))),
        Buffer.from(node.port.toString(16), 'hex')
      ]);
    } catch (e) {
      console.error(e, node);
    }
  }
  constructor(node) {
    super();
    return Object.assign(this, {
      status: 0,
      lastchange: Date.now()
    }, node);
  }
  get valid() {
    return this.address && this.port > 0 && this.port < 0xffff && Buffer.isBuffer(this.id)
  }
  /**
   * diff two node distance
   * @param {*} id 
   */
  distance(id) {
    return _.closest(this.id, id);
  }
  /**
   * is same node
   * @param {*} id 
   */
  is(id) {
    if (typeof id === 'object') id = id.id;
    if (id instanceof Buffer) id = id.toString('hex');
    return this.id.toString('hex') === id;
  }
  inspect() {
    const { id, address, port, status, lastchange } = this;
    const ago = (Date.now() - lastchange) / 1000;
    return `
         id: ${id.toString('hex')}
    address: ${address}
       port: ${port}
     status: ${status}
 lastchange: ${ago} seconds ago`;
  }
}

Node.STATUS = {
  GOOD   : 0,
  DUBIOUS: 1,
  BAD    : 2,
};

module.exports = Node;
