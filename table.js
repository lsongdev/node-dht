const Node = require('./node');
const _ = require('./util');
const EventEmitter = require('events');

const K = 8;

class KBucket {
  constructor(min, max) {
    this.min = min;
    this.max = max;
    this.nodes = [];
    this.lastChanged = Date.now();
  }

  contains(id) {
    const distToMin = _.xorDistance(id, this.min);
    const distToMax = _.xorDistance(id, this.max);
    const range = _.xorDistance(this.min, this.max);
    return _.compareDistance(distToMin, range) < 0 && _.compareDistance(distToMax, range) >= 0;
  }

  split() {
    const mid = Buffer.alloc(this.min.length);
    for (let i = 0; i < this.min.length; i++) {
      mid[i] = this.min[i] | (this.max[i] & ~this.min[i]) >> 1;
    }
    const newMax = Buffer.from(mid);
    const newMin = Buffer.from(mid);
    newMax[newMax.length - 1] |= 1;
    newMin[newMin.length - 1] &= 0xFE;

    const left = new KBucket(Buffer.from(this.min), newMin);
    const right = new KBucket(newMax, Buffer.from(this.max));

    for (const node of this.nodes) {
      const nodeDist = _.xorDistance(node.id, this.min);
      if (_.compareDistance(nodeDist, _.xorDistance(this.min, newMax)) < 0) {
        left.nodes.push(node);
      } else {
        right.nodes.push(node);
      }
    }

    return [left, right];
  }
}

class Table extends EventEmitter {
  constructor(rpc, options) {
    super();
    Object.assign(this, {
      interval: 10 * 1000
    }, options);
    this.rpc = rpc;
    this.buckets = [new KBucket(
      Buffer.alloc(20, 0),
      Buffer.alloc(20, 0xFF)
    )];
    this.rpc.on('response', this.onResponse.bind(this));
    this.checkInterval = setInterval(this.check.bind(this), this.interval);
    return this;
  }

  get length() {
    return this.buckets.reduce((sum, b) => sum + b.nodes.length, 0);
  }

  findBucket(id) {
    for (const bucket of this.buckets) {
      if (bucket.contains(id)) {
        return bucket;
      }
    }
    return this.buckets[0];
  }

  onResponse(msg, remote) {
    if (msg.r && msg.r.id) {
      const node = new Node({
        id: msg.r.id,
        address: remote.address,
        port: remote.port
      });
      this.add(node);
    }
  }

  check() {
    const fifteenMinutes = 15 * 60 * 1000;
    const now = Date.now();

    for (const bucket of this.buckets) {
      if ((now - bucket.lastChanged) > fifteenMinutes) {
        const randomId = Buffer.alloc(20);
        for (let i = 0; i < 20; i++) {
          randomId[i] = bucket.min[i] + Math.floor(Math.random() * (bucket.max[i] - bucket.min[i] + 1));
        }
        this.rpc.find_node(randomId).catch(() => {});
      }

      bucket.nodes = bucket.nodes.filter(node => node.status !== Node.STATUS.BAD);

      for (const node of bucket.nodes) {
        if ((now - node.lastchange) > fifteenMinutes) {
          switch (node.status) {
            case Node.STATUS.DUBIOUS:
              node.status = Node.STATUS.BAD;
              break;
            case Node.STATUS.GOOD:
              node.status = Node.STATUS.DUBIOUS;
              break;
          }
          this.emit('status', node.status, node);
          this.rpc.ping(node).then(({ id }) => {
            if (node.is(id)) {
              node.lastchange = Date.now();
              node.status = Node.STATUS.GOOD;
              bucket.lastChanged = Date.now();
            }
          }).catch(() => {});
        }
      }
    }
    return this;
  }

  get(id, k = K) {
    const bucket = this.findBucket(id);
    const nodes = bucket.nodes.slice();

    const bucketIndex = this.buckets.indexOf(bucket);
    let left = bucketIndex - 1;
    let right = bucketIndex + 1;

    while (nodes.length < k && (left >= 0 || right < this.buckets.length)) {
      if (left >= 0) {
        nodes.push(...this.buckets[left].nodes);
        left--;
      }
      if (right < this.buckets.length) {
        nodes.push(...this.buckets[right].nodes);
        right++;
      }
    }

    const distances = nodes.map(node => ({
      node,
      dist: _.xorDistance(node.id, id)
    }));

    distances.sort((a, b) => _.compareDistance(a.dist, b.dist));
    return distances.slice(0, k).map(d => d.node);
  }

  add(node) {
    if (Array.isArray(node)) {
      node.forEach(x => this.add(x));
      return this;
    }
    if (!(node instanceof Node)) {
      node = new Node(node);
    }
    if (!node.valid) return this;

    const bucket = this.findBucket(node.id);

    if (this.has(node)) {
      const existing = bucket.nodes.find(n => n.is(node));
      if (existing) {
        existing.lastchange = Date.now();
        existing.status = Node.STATUS.GOOD;
        bucket.lastChanged = Date.now();
      }
      return this;
    }

    if (bucket.nodes.length < K) {
      bucket.nodes.push(node);
      bucket.lastChanged = Date.now();
      return this;
    }

    const ourId = this.rpc.id;
    if (bucket.contains(ourId)) {
      const [left, right] = bucket.split();
      const bucketIndex = this.buckets.indexOf(bucket);
      this.buckets.splice(bucketIndex, 1, left, right);
      return this.add(node);
    }

    const badNode = bucket.nodes.find(n => n.status === Node.STATUS.BAD);
    if (badNode) {
      const idx = bucket.nodes.indexOf(badNode);
      bucket.nodes[idx] = node;
      bucket.lastChanged = Date.now();
    }

    return this;
  }

  has(node) {
    if (typeof node === 'string' || Buffer.isBuffer(node)) {
      return this.buckets.some(bucket =>
        bucket.nodes.some(n => n.is(node))
      );
    }
    return this.buckets.some(bucket =>
      bucket.nodes.some(n => n.is(node))
    );
  }
}

Table.Node = Node;

module.exports = Table;
