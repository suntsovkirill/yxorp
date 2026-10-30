module.exports = (req, res) => {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ params: req.mockRuleParams, query: req.query }));
};
