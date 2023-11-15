module.exports = (req, res) => {
  const data = { mocked: true, source: 'dynamic', timestamp: Date.now() };
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(data));
};
