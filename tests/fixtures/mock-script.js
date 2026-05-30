module.exports = (req, res) => {
  res.statusCode = 201;
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ mocked: true, source: 'script', value: 99 }));
};
