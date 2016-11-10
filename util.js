const crypto  = require('crypto');

const randomID = (len = 20) => {
  return crypto.randomBytes(len);
}

const closest = (a, b) => {
  if(a instanceof Buffer) a = a.toString('hex');
  if(b instanceof Buffer) b = a.toString('hex');
  if(a.length !== b.length) throw new Error('must be equal');
  const res = [];
  for(let i = 0; i < a.length; i++){
    res.push(Math.abs(parseInt(a[i], 16) - parseInt(b[i], 16)));
  }
  return res.reduce((distance, n, i) => {
    distance += Math.pow(16, res.length - i - 1) * n;
    return distance;
  }, 0);
};

module.exports = {
  randomID,
  closest
};