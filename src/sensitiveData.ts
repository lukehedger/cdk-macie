export const handler = async () => {
  console.log({
    name: "John Doe",
    address: "8-10 New Fetter Ln, London EC4A 1AZ",
    AWS_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    card_number: "2222 4000 7000 0005",
  });

  return {
    statusCode: 200,
    headers: { "Content-Type": "text/plain" },
    body: "Hello, World",
  };
};
