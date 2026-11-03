/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));

const { getModels } = require('../models');
const { listTerms } = require('../services/requestMetadataService');

describe('term metadata exposure', () => {
  const Term = { findAll: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    getModels.mockReturnValue({ Term });
  });

  it('returns numeric exposure values alongside term IDs and labels', async () => {
    Term.findAll.mockResolvedValue([
      { ID: 'term-30', NAME: '30 days', EXPOSURE: '30.00' },
      { ID: 'term-custom', NAME: 'Custom', EXPOSURE: '42.5' },
      { ID: 'term-no-exposure', NAME: 'No exposure', EXPOSURE: null },
      { ID: 'term-invalid', NAME: 'Invalid', EXPOSURE: 'not-a-number' },
    ]);

    await expect(listTerms()).resolves.toEqual([
      { id: 'term-30', label: '30 days', exposure: 30 },
      { id: 'term-custom', label: 'Custom', exposure: 42.5 },
      { id: 'term-no-exposure', label: 'No exposure', exposure: null },
      { id: 'term-invalid', label: 'Invalid', exposure: null },
    ]);
    expect(Term.findAll).toHaveBeenCalledWith({ order: [['NAME', 'ASC']] });
  });
});
