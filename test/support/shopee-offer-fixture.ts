// Independently authored synthetic data; never copied from an authenticated reply.
export const shopeeOfferFixture = () => ({
  data: {
    productOfferV2: {
      nodes: [
        {
          itemId: '9007199254740993',
          shopId: '9007199254740995',
          productName: 'Organizador sintético',
          shopName: 'Loja sintética',
          price: '12345678901234567890.00100',
          priceMin: '0.00001',
          priceMax: '12345678901234567890.00100',
          commissionRate: '0.01234500',
          commission: '0.00000001',
          priceDiscountRate: 15,
          imageUrl: 'https://example.invalid/image.png',
          productLink: 'https://example.invalid/product',
          offerLink: 'https://example.invalid/offer',
        },
      ],
      pageInfo: { page: 1, limit: 2, hasNextPage: true },
    },
  },
});
