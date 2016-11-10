## DHT

> Simple Distributed Hash Table implementation in JavaScript

[![dht-lite](https://img.shields.io/npm/v/dht-lite.svg)](https://npmjs.org/dht-lite)

### Example

```js
const DHT = require('dht-lite');

const dht = new DHT({ });

dht.on('error', function(err){
  console.error(err);
});

dht.find_node();

```

DHT Spider Exmaple:

```js
const Spider = require('dht-lite/spider');

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

```

### Contributing
- Fork this Repo first
- Clone your Repo
- Install dependencies by `$ npm install`
- Checkout a feature branch
- Feel free to add your features
- Make sure your features are fully tested
- Publish your local branch, Open a pull request
- Enjoy hacking <3

### MIT

Copyright (c) 2016 lsong

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.


---
