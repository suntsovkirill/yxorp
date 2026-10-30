// Reads the request stream directly, the way scripts did before req.json() existed.
module.exports = (req, res) => {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => res.end(JSON.stringify({ body })));
};
