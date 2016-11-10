const DHT = require('..');
const Spider = require('../spider');

const dht = new Spider({
  bootstraps: [
    { address: 'router.bittorrent.com', port: 6881 },
    { address: 'dht.transmissionbt.com', port: 6881 }
  ]  
});

dht.on('error', err => {
  console.log('Error:', err.message, err.task && err.task.message.a);
});

dht.on('query', query => {
  console.log('query', query.q.toString(), query);
});

dht.on('get_peers', (request, response) => {
  const { id, info_hash } = request;
  console.log("magnet:?xt=urn:btih:%s", info_hash.toString("hex"));
  const { target } = request;
  const nodes = Buffer.concat(dht.get(target).map(DHT.Node.encode));
  response({ nodes });
})

dht.listen(6881, function(err){
  console.log('DHT is running ...');
});

setInterval(async () => {
  await dht.makeNeighbor();
  console.log(`current nodes: ${dht.table.nodes.length}`);
}, 1000);
