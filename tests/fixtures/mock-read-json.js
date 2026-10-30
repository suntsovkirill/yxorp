module.exports = async (req, res) => {
  const data = await req.json();
  res.end(JSON.stringify({ received: data, again: await req.text() }));
};
