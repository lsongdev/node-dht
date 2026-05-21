const _ = require('./util');
const RPC = require('./rpc');
const Table = require('./table');

class DHT extends RPC {
  static BOOTSTRAP_NODES = [
    { address: 'router.bittorrent.com', port: 6881 },
    { address: 'dht.transmissionbt.com', port: 6881 },
    { address: 'router.utorrent.com', port: 6881 }
  ];

  static createServer(options) {
    return new DHT(options);
  }

  constructor(options) {
    super(options);
    this.table = new Table(this);
    this.bootstraps = DHT.BOOTSTRAP_NODES.map(n => new Table.Node(n));
    this.on('ping', this.onPing.bind(this));
    this.on('find_node', this.onFindNode.bind(this));
    this.on('get_peers', this.onGetPeers.bind(this));
    this.on('announce_peer', this.onAnnouncePeer.bind(this));
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

  onPing(request, response, error) {
    const { id } = request;
    if (this.table.has(id)) {
      response({ id: this.id });
    } else {
      this.table.add(new Table.Node({ id, address: request.remote.address, port: request.remote.port }));
      response({ id: this.id });
    }
  }

  onFindNode(request, response, error) {
    const { id, target } = request;
    if (!id || id.length !== 20) {
      return error(203, 'Invalid id');
    }
    this.table.add(new Table.Node({ id, address: request.remote.address, port: request.remote.port }));
    const nodes = Buffer.concat(this.get(target).map(DHT.Node.encode));
    response({ id: this.id, nodes });
  }

  onGetPeers(request, response, error) {
    const { id, info_hash } = request;
    if (!id || id.length !== 20) {
      return error(203, 'Invalid id');
    }
    if (!info_hash || info_hash.length !== 20) {
      return error(203, 'Invalid info_hash');
    }
    this.table.add(new Table.Node({ id, address: request.remote.address, port: request.remote.port }));
    const nodes = Buffer.concat(this.get(info_hash).map(DHT.Node.encode));
    const token = this.generateToken(request.remote);
    const peers = this.peers[info_hash.toString('hex')] || [];
    if (peers.length > 0) {
      response({ id: this.id, token, values: peers });
    } else {
      response({ id: this.id, token, nodes });
    }
  }

  onAnnouncePeer(request, response, error) {
    const { id, info_hash, token, implied_port, port } = request;
    if (!id || id.length !== 20) {
      return error(203, 'Invalid id');
    }
    if (!info_hash || info_hash.length !== 20) {
      return error(203, 'Invalid info_hash');
    }
    if (!this.validateToken(token, request.remote)) {
      return error(203, 'Bad token');
    }
    this.table.add(new Table.Node({ id, address: request.remote.address, port: request.remote.port }));
    const announcePort = implied_port ? request.remote.port : port;
    const key = info_hash.toString('hex');
    if (!this.peers[key]) {
      this.peers[key] = [];
    }
    const peerBuf = Buffer.alloc(6);
    const ipParts = request.remote.address.split('.');
    for (let i = 0; i < 4; i++) {
      peerBuf[i] = parseInt(ipParts[i]);
    }
    peerBuf.writeUInt16BE(announcePort, 4);
    if (!this.peers[key].some(p => p.equals(peerBuf))) {
      this.peers[key].push(peerBuf);
    }
    response({ id: this.id });
  }

  listen(port = this.port, callback) {
    this.bind(port, callback);
    return this;
  }
};

DHT.Table = Table;
DHT.Node = Table.Node;
DHT.randomID = _.randomID;

module.exports = DHT;
