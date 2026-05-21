const _ = require('./util');
const Node = require('./node');
const udp = require('dgram');
const bencode = require('bencode');
const crypto = require('crypto');

class RPC extends udp.Socket {
  constructor(options) {
    super(Object.assign({
      type: 'udp4',
    }, options));
    Object.assign(this, {
      id: _.randomID(),
      port: 6881,
      timeout: 5000,
      version: Buffer.from('LT0001')
    }, options);
    this.$ = {};
    this._tokenSecret = crypto.randomBytes(20);
    this._tokenSecretTime = Date.now();
    this.peers = {};
    this.on('message', this.parse.bind(this));
    return this;
  }

  generateToken(remote) {
    const now = Date.now();
    if (now - this._tokenSecretTime > 5 * 60 * 1000) {
      this._tokenSecret = crypto.randomBytes(20);
      this._tokenSecretTime = now;
    }
    const hash = crypto.createHash('sha1');
    hash.update(remote.address);
    hash.update(this._tokenSecret);
    return hash.digest();
  }

  validateToken(token, remote) {
    if (!Buffer.isBuffer(token) || token.length < 20) return false;
    const now = Date.now();
    const validToken = this.generateToken(remote);
    if (token.equals(validToken)) return true;
    if (now - this._tokenSecretTime > 5 * 60 * 1000) {
      const oldSecret = this._tokenSecret;
      const oldTime = this._tokenSecretTime;
      this._tokenSecret = crypto.randomBytes(20);
      this._tokenSecretTime = now;
      const hash = crypto.createHash('sha1');
      hash.update(remote.address);
      hash.update(oldSecret);
      const oldToken = hash.digest();
      return token.equals(oldToken);
    }
    return false;
  }

  sendRPC(message, remotes, fn) {
    if (!Array.isArray(remotes)) remotes = this.get();
    message.t = _.randomID(2);
    message.v = this.version;
    const task = { id: message.t, message, done: false, remotes };
    task.timeout = setTimeout(() => {
      if (!task.done) {
        task.errors.push(new Error(`Timeout #${task.id}`));
        task.callback(task.errors, task.values);
      }
    }, this.timeout);
    return new Promise((resolve, reject) => {
      task.errors = [];
      task.values = [];
      task.callback = (errors, values) => {
        if (task.done) return console.log('double callback()!');
        task.done = true;
        if (fn) fn(errors, values);
        if (values.length > 0)
          return resolve(values);
        reject(errors);
      };
      this.$[task.id] = task;
      if (message.y == 'r') task.callback(null, [message]);
      message = bencode.encode(message);
      remotes.forEach(node => this.send(message, node.port, node.address));
    });
  }

  query(method, params, remotes) {
    return this.sendRPC({
      y: 'q',
      q: method,
      a: params,
    }, remotes);
  }

  response(remote, request, value) {
    const { t } = request;
    return this.sendRPC({
      t,
      y: 'r',
      r: value
    }, [remote]);
  }

  error(remote, request, code, message) {
    const { t } = request;
    const msg = bencode.encode({
      t,
      y: 'e',
      e: [code, message]
    });
    this.send(msg, remote.port, remote.address);
  }

  parse(data, rinfo) {
    try {
      var msg = bencode.decode(data);
      msg.remote = rinfo;
    } catch (e) {
      this.emit('error', e);
      return this;
    }
    let { y: type, v: version, t: transactionId, e: error } = msg;
    type = `${type}`;
    version = `${version}`;
    const task = this.$[transactionId];
    const err = new Error();
    err.type = type;
    err.msg = msg;
    err.data = data;
    err.task = task;
    err.id = transactionId;

    switch (type) {
      case 'r':
        if (task) {
          task.values.push(msg);
          if (task.values.length + task.errors.length === task.remotes.length) {
            task.callback(task.errors, task.values);
          }
        } else {
          err.name = 'Task NotFound';
          err.message = `#${transactionId} not found`;
          this.emit('error', err);
        }
        this.emit('response', msg, rinfo);
        break;
      case 'q':
        this.emit('query', msg);
        this.emit(`${msg.q}`, msg.a, this.response.bind(this, rinfo, msg), this.error.bind(this, rinfo, msg), rinfo, msg);
        break;
      case 'e':
        [err.code, err.message] = error;
        err.message = err.message.toString();
        if (task) task.errors.push(err);
        this.emit('error', err);
        break;
      default:
        err.name = `Unknown type: ${type}, ${version}`;
        this.emit('error', err);
        break;
    }
  }

  ping(remote) {
    const { id } = this;
    return this
      .query('ping', { id }, remote ? [remote] : undefined)
      .then(([res]) => res)
      .then(({ r, remote }) => {
        const { address, port } = remote;
        return { address, port, id: r.id.toString() };
      });
  }

  announce_peer(info_hash, remotes, token) {
    const { id, port } = this;
    if (!Array.isArray(remotes))
      remotes = this.get(info_hash);
    return this.query('announce_peer', {
      id,
      port,
      info_hash,
      implied_port: 1,
      token: token || Buffer.alloc(0)
    }, remotes);
  }

  find_node(target, remotes) {
    const { id } = this;
    if (!Array.isArray(remotes))
      remotes = this.get(target);
    return this
      .query('find_node', { id, target }, remotes)
      .then(res => res.map(x => Node.createNodes(x.r.nodes)))
      .then(nodes => [].concat.apply([], nodes));
  }

  get_peers(info_hash, remotes) {
    const { id } = this;
    if (!Array.isArray(remotes))
      remotes = this.get(info_hash);
    return this.query('get_peers', {
      id, info_hash
    }, remotes).then(res => {
      const result = { nodes: [], peers: [], tokens: [] };
      for (const msg of res) {
        if (msg.r.nodes) {
          const nodes = Node.createNodes(msg.r.nodes);
          result.nodes.push(...nodes);
        }
        if (msg.r.values) {
          result.peers.push(...msg.r.values);
        }
        if (msg.r.token) {
          result.tokens.push({ token: msg.r.token, remote: msg.remote });
        }
      }
      return result;
    }).then(result => {
      if (result.peers.length) return result;
      if (result.nodes.length === 0) return result;
      return this.get_peers(info_hash, result.nodes).then(nextResult => {
        return {
          nodes: nextResult.nodes,
          peers: result.peers.concat(nextResult.peers),
          tokens: result.tokens.concat(nextResult.tokens)
        };
      });
    });
  }
}

module.exports = RPC;
