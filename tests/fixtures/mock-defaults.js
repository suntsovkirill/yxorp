module.exports = (req, res) => {
  if (req.query.override) {
    res.statusCode = 200;
    res.setHeader('x-mock', 'from-script');
  }
  res.end(JSON.stringify({ status: res.statusCode }));
};
