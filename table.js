const Node = require('./node');
const EventEmitter = require('events');

class Table extends EventEmitter {
  constructor(rpc, options) {
    super();
    Object.assign(this, {
      nodes: [],
      interval: 10 * 1000
    }, options);
    this.rpc = rpc;
    this.rpc.on('response', this.refresh.bind(this));
    this.checkInterval = setInterval(this.check.bind(this), this.interval);
    return this;
  }
  get length() {
    return this.nodes.length;
  }
  refresh(msg, remote) {
    this.nodes.forEach(node => {
      if (node.address == remote.address && node.port == remote.port) {
        // Each bucket should maintain a "last changed" property to indicate how "fresh" the contents are.
        node.lastchange = Date.now();
      }
    });
  }
  check() {
    // Buckets that have not been changed in 15 minutes should be "refreshed." 
    const fifteenMinutes = 15 * 60 * 1000;
    this.nodes = this.nodes.filter(node => node.status != Node.STATUS.BAD);
    this.nodes.filter(node => (Date.now() - node.lastchange) > fifteenMinutes).forEach(node => {
      switch (node.status) {
        case Node.STATUS.DUBIOUS:
          // Nodes become bad when they fail to respond to multiple queries in a row.
          node.status = Node.STATUS.BAD;
          break;
        case Node.STATUS.GOOD:
          // After 15 minutes of inactivity, a node becomes questionable.
          node.status = Node.STATUS.DUBIOUS;
          break;
        case Node.STATUS.BAD:
          break;
        default:
          break;
      }
      this.emit('status', node.status, node);
      this.rpc.ping(node).then(({ id }) => {
        if (node.is(id)) {
          console.log('pong', node);
          node.lastchange = Date.now();
          node.status = Node.STATUS.GOOD;
        }
      }, e => this.emit('warning', e));
    });
    return this;
  }
  get(id, k = 8) {
    return this.nodes.sort((a, b) => a.distance(id) - b.distance(id)).slice(0, k);
  }
  add(node) {
    if (Array.isArray(node)) {
      node.forEach(x => this.add(x));
      return this;
    }
    if (!(node instanceof Node))
      node = new Node(node);
    if (node.valid && !this.has(node))
      this.nodes.push(node);
    return this;
  }
  /**
   * has node
   * @param {*} node
   */
  has(node) {
    return this.nodes.some(x => x.is(node))
  }
}

Table.Node = Node;

module.exports = Table;
