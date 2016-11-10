const DHT = require('.');

class Spider extends DHT {
  neighbor(id = this.id, n = 18) {
    return Buffer.concat([id.slice(0, n), this.id.slice(n)]);
  }
  /**
   * makeNeighbor
   */
  makeNeighbor() {
    if (this.table.length < 50)
      return this.join();
    const target = DHT.randomID();
    const nodes = this.table.get(target);
    return nodes.map(node => {
      const id = this.neighbor(node.id);
      return this.query('find_node', { id, target }, [node]).catch(e => e);
    });
  }
  onPing(request, response) {
    const { id } = request;
    response({ id: this.neighbor(id) });
  }
  onFindNode(request, response) {
    const { id, target } = request;
    let nodes = this.get(target);
    nodes = Buffer.concat(nodes.map(DHT.Node.encode));
    response({ id: this.neighbor(id), nodes });
  }
}

module.exports = Spider;
