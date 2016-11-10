const _ = require('./util');
const RPC = require('./rpc');
const Table = require('./table');
/**
 * [DHT description]
 * @docs http://bittorrent.org/beps/bep_0005.html
 */
class DHT extends RPC {
  /**
   * createServer
   * @param {*} options 
   */
  static createServer(options) {
    return new DHT(options);
  }
  constructor(options) {
    super(options);
    this.table = new Table(this);
    this.on('ping', this.onPing.bind(this));
    this.on('find_node', this.onFindNode.bind(this));
    this.on('get_peers', this.onGetPeers.bind(this));
    return this;
  }
  add(node) {
    this.table.add(node);
    return this;
  }
  get(id = this.id, k = 8) {
    if (this.table.length < k) {
      return this.bootstraps;
    }
    return this.table.get(id, k);
  }
  join() {
    return this
      .find_node(_.randomID())
      .then(nodes => this.add(nodes))
      .catch(e => this.emit('warning', e));
  }
  onPing(request, response) {
    if (this.table.has(request)) {
      response({ id: this.id });
    } else {
      this.emit('error', new Error(`ping, not found id ${request.id}`));
    }
  }
  onFindNode(request, response) {
    const { id, target } = request;
    if (this.table.has(id)) {
      const nodes = Buffer.concat(this.get(target).map(DHT.Node.encode));
      response({ id: this.id, nodes });
    }
  }
  onGetPeers(request, response) {
    const { id, info_hash } = request;
    if (this.table.has(id)) {
      const nodes = Buffer.concat(this.get(info_hash).map(DHT.Node.encode));
      response({ id: this.id, nodes });
    }
  }
  /**
   * listen
   * @param {*} port 
   * @param {*} callback 
   */
  listen(port = this.port, callback) {
    this.bind(port, callback);
    return this;
  }
};

DHT.Table = Table;
DHT.Node = Table.Node;
DHT.randomID = _.randomID;

module.exports = DHT;
