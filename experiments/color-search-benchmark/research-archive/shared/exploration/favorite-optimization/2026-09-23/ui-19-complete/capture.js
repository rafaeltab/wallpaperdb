(() => {
  window.__favoriteQa = { responses: [], errors: [] };
  addEventListener('error', event => window.__favoriteQa.errors.push({ type: 'error', message: event.message }));
  addEventListener('unhandledrejection', event => window.__favoriteQa.errors.push({ type: 'rejection', message: String(event.reason) }));
  const original = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const request = { url: String(args[0]), method: args[1]?.method || 'GET', body: args[1]?.body || null };
    try {
      const response = await original(...args);
      const copy = response.clone();
      copy.json().then(body => window.__favoriteQa.responses.push({ request, status: response.status, body })).catch(() => {});
      return response;
    } catch (error) {
      window.__favoriteQa.responses.push({ request, error: String(error), aborted: args[1]?.signal?.aborted === true });
      throw error;
    }
  };
})();
