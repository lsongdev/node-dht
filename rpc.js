const _       = require('./util');
const Node    = require('./node');
const udp     = require('dgram');
const bencode = require('bencode');

class RPC extends udp.Socket {
  constructor(options){
    super(Object.assign({
      type: 'udp4',
    }, options));
    Object.assign(this, {
      id: _.randomID(),
      port: 6881,
      timeout: 5000
    }, options);
    this.$ = {};
    this.on('message', this.parse.bind(this));
    return this;
  }
  /**
   * sendRPC
   * @param {*} message 
   * @param {*} remotes 
   */
  sendRPC(message, remotes, fn){
    if(!Array.isArray(remotes)) remotes = this.get();
    // The transaction ID should be encoded as a short string of binary numbers, 
    // typically 2 characters are enough as they cover 2^16 outstanding queries. 
    message.t = _.randomID(2);
    // create task to queue
    const task = { id: message.t, message, done: false, remotes };
    task.timeout = setTimeout(() => {
      if(!task.done) {
        task.errors.push(new Error(`Timeout #${task.id}`));
        task.callback(task.errors, task.values);
      }
    }, this.timeout);
    return new Promise((resolve, reject) => {
      task.errors = [];
      task.values = [];
      task.callback = (errors, values) => {
        //this.$[task.id] = null;
        //delete this.$[task.id];
        if(task.done) return console.log('double callback()!');
        task.done = true;
        if(fn) fn(errors, values);
        if(values.length > 0) 
          return resolve(values);
        reject(errors);
      };
      this.$[ task.id ] = task;
      if(message.y == 'r') task.callback(null, [message]);
      message = bencode.encode(message);
      remotes.forEach(node => this.send(message, node.port, node.address));
      
    });
  }
   /**
   * Queries, or KRPC message dictionaries with a "y" value of "q", 
   * contain two additional keys; "q" and "a". 
   * Key "q" has a string value containing the method name of the query. 
   * Key "a" has a dictionary value containing named arguments to the query.
   * @param {*} method 
   * @param {*} params 
   */
  query(method, params, remotes){
    return this.sendRPC({
      y: 'q',
      q: method,
      a: params,
    }, remotes);
  }
  /**
   * Responses, or KRPC message dictionaries with a "y" value of "r", 
   * contain one additional key "r". 
   * The value of "r" is a dictionary containing named return values. 
   * Response messages are sent upon successful completion of a query.
   * @param {*} remote 
   * @param {*} value 
   */
  response(remote, request, value){
    const { t } = request;
    return this.sendRPC({
      t,
      y: 'r',
      r: value
    }, [ remote ]);
  }
  /**
   * parse
   * @param {*} data 
   * @param {*} rinfo 
   */
  parse(data, rinfo){
    try {
      var msg = bencode.decode(data);
      msg.remote = rinfo;
    } catch(e) {
      this.emit('error', e);
      return this;
    }
    let { y: type, v: version, t: transactionId, e: error } = msg;
    type = `${type}`;
    version = `${version}`;
    // task
    const task = this.$[transactionId];
    // error
    const err = new Error();
    err.type = type;
    err.msg = msg;
    err.data = data;
    err.task = task;
    err.id = transactionId;
    //
    switch (type) {
      case 'r': // response
        if(task) {
          task.values.push(msg);
          if(task.values.length + task.errors.length === task.remotes.length){
            task.callback(task.errors, task.values);
          }
        } else {
          err.name = 'Task NotFound';
          err.message = `#${transactionId} not found`;
          this.emit('error', err);
        }
        this.emit('response', msg, rinfo);
        break;
      case 'q': // query
        this.emit('query', msg);
        this.emit(`${msg.q}`, msg.a, this.response.bind(this, rinfo, msg), rinfo, msg);
        break;
      case 'e':
        [ err.code, err.message ] = error;
        err.message = err.message.toString();
        if(task) task.errors.push(err);
        this.emit('error', err);
        break;
      default:
        err.name = `Unknow type: ${type}, ${version}`;
        this.emit('error', err);
        break;
    }
    
  }
  /**
   * The most basic query is a ping. 
   * "q" = "ping" A ping query has a single argument, 
   * "id" the value is a 20-byte string containing the senders node ID in network byte order. 
   * The appropriate response to a ping has a single key "id" containing the node ID of the responding node.
   * @docs http://bittorrent.org/beps/bep_0005.html#ping
   */
  ping(remote){
    const { id } = this;
    return this
      .query('ping', { id })
      .then(([ res ]) => res)
      .then(({ r, remote }) => {
        const { address, port } = remote;
        return { address, port, id: r.id.toString() };
      }, remote && [ remote ]);
  }
  /**
   * Announce that the peer, controlling the querying node, 
   * is downloading a torrent on a port. 
   * announce_peer has four arguments: "id" containing the node ID of the querying node, 
   * "info_hash" containing the infohash of the torrent, 
   * "port" containing the port as an integer, 
   * and the "token" received in response to a previous get_peers query. 
   * The queried node must verify that the token was previously sent to the same IP address as the querying node. 
   * Then the queried node should store the IP address of 
   * the querying node and the supplied port number under 
   * the infohash in its store of peer contact information.
   * There is an optional argument called implied_port which value is either 0 or 1. 
   * If it is present and non-zero, 
   * the port argument should be ignored and the source port of 
   * the UDP packet should be used as the peer's port instead. 
   * This is useful for peers behind a NAT that may not know their external port, 
   * and supporting uTP, they accept incoming connections on the same port as the DHT port.
   * @docs http://bittorrent.org/beps/bep_0005.html#announce_peer
   * @param {*} info_hash 
   */
  announce_peer(info_hash, remotes){
    const { id, port } = this;
    if(!Array.isArray(remotes))
      remotes = this.get(info_hash);
    return this.query('announce_peer', {
      id,
      port,
      info_hash,
      implied_port: 1,
      token: info_hash.slice(0, 2)
    }, remotes);
  }
  /**
   * Find node is used to find the contact information for a node given its ID. 
   * "q" == "find_node" A find_node query has two arguments, "id" containing the 
   * node ID of the querying node, and "target" containing the ID of the node 
   * sought by the queryer. When a node receives a find_node query, it should 
   * respond with a key "nodes" and value of a string containing the compact 
   * node info for the target node or the K (8) closest good nodes in its own routing table.
   * @docs http://bittorrent.org/beps/bep_0005.html#find-node
   * @param {*} target 
   */
  find_node(target, remotes){
    const { id } = this;
    if(!Array.isArray(remotes))
      remotes = this.get(target);
    return this
      .query('find_node', { id, target }, remotes)
      .then(res => res.map(x => Node.createNodes(x.r.nodes)))
      .then(nodes => [].concat.apply([], nodes));
  }
  /**
   * Get peers associated with a torrent infohash. 
   * "q" = "get_peers" A get_peers query has two arguments, 
   * "id" containing the node ID of the querying node, 
   * and "info_hash" containing the infohash of the torrent. 
   * If the queried node has peers for the infohash, 
   * they are returned in a key "values" as a list of strings. 
   * Each string containing "compact" format peer information for a single peer. 
   * If the queried node has no peers for the infohash, 
   * a key "nodes" is returned containing the K nodes in the 
   * queried nodes routing table closest to the infohash supplied in the query. 
   * In either case a "token" key is also included in the return value. 
   * The token value is a required argument for a future announce_peer query. 
   * The token value should be a short binary string.
   * @docs http://bittorrent.org/beps/bep_0005.html#get_peer
   * @param {*} info_hash 
   */
  get_peers(info_hash, remotes){
    const { id } = this;
    if(!Array.isArray(remotes)) 
      remotes = this.get(info_hash);
    return this.query('get_peers', {
      id, info_hash
    }, remotes).then(res => {
      console.log('get_peers', res);
      return res.reduce((result, res) => {
        if(res.nodes) result.nodes.push(res.nodes);
        if(res.peers) result.peers.push(res.peers);
        return result;
      }, { nodes: [], peers: [] });
    }).then((nodes, peers) => {
      if(peers.length) return peers;
      return this.get_peers(info_hash, nodes);
    });
  }
}
  
module.exports = RPC;
