for (const key of Object.keys(process.env))
  if (/(?:TOKEN|SECRET|PASSWORD|API_?KEY|CREDENTIAL)/i.test(key)) delete process.env[key];
