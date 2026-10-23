/* eslint-env jest */

jest.mock('../models', () => ({ getModels: jest.fn() }));
jest.mock('../config/database', () => ({ getDatabase: jest.fn() }));
jest.mock('../services/attachmentService', () => ({}));

const { getModels } = require('../models');
const { Op } = require('sequelize');
const requestService = require('../services/requestService');

describe('requestService.listRequests sorting', () => {
  it('orders by CREATED_DATE descending by default', async () => {
    const findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 0 });
    getModels.mockReturnValue({
      Request: { findAndCountAll },
      Rating: {},
      Term: {},
      Status: {},
      Employee: {},
    });

    await requestService.listRequests({});

    expect(findAndCountAll).toHaveBeenCalledWith(expect.objectContaining({
      order: [['CREATED_DATE', 'DESC']],
    }));
  });

  it('returns SAP status separately and displays Waiting-Approval as a dash', async () => {
    const waitingApprovalId = '4ba2cdc6-47aa-41bd-99a0-79e1e6b0831b';
    const completedId = '407e23f9-caf5-4c4a-801d-598cf437d1ae';
    const rows = [
      { ID: 'waiting', STATUS_ID: 'draft', status: { NAME: 'Draft' }, STATUS_SAP_ID: waitingApprovalId.toUpperCase(),
        sapStatus: { NAME: 'Waiting-Approval' } },
      { ID: 'completed', STATUS_ID: 'final', status: { NAME: 'Final' }, STATUS_SAP_ID: completedId,
        sapStatus: { NAME: 'Completed' } },
    ];
    const findAndCountAll = jest.fn().mockResolvedValue({ rows, count: rows.length });
    const Status = {};
    getModels.mockReturnValue({
      Request: { findAndCountAll },
      Rating: {},
      Term: {},
      Status,
      Employee: {},
    });

    const result = await requestService.listRequests({});

    expect(result.items.map(({ STATUS, STATUS_SAP_ID, SAP_STATUS }) => ({ STATUS, STATUS_SAP_ID, SAP_STATUS })))
      .toEqual([
        { STATUS: 'Draft', STATUS_SAP_ID: waitingApprovalId.toUpperCase(), SAP_STATUS: '-' },
        { STATUS: 'Final', STATUS_SAP_ID: completedId, SAP_STATUS: 'Completed' },
      ]);
    expect(findAndCountAll.mock.calls[0][0].include).toContainEqual({ model: Status, as: 'sapStatus', required: false });
  });

  it('returns Yes only when BDS notes contain visible text', async () => {
    const rows = [
      { ID: 'with-notes', BDS_NOTES: '<p>Follow up with customer</p>' },
      { ID: 'empty-editor', BDS_NOTES: '<p><br></p>' },
      { ID: 'nbsp-editor', BDS_NOTES: '<p>&nbsp;</p>' },
      { ID: 'null-notes', BDS_NOTES: null },
      { ID: 'empty-notes', BDS_NOTES: '' },
    ];
    const findAndCountAll = jest.fn().mockResolvedValue({ rows, count: rows.length });
    getModels.mockReturnValue({ Request: { findAndCountAll }, Rating: {}, Term: {}, Status: {}, Employee: {} });

    const result = await requestService.listRequests({});

    expect(result.items.map((request) => request.TAKE_NOTES)).toEqual(['Yes', 'No', 'No', 'No', 'No']);
  });

  it.each(['Yes', 'No'])('filters requests by TAKE_NOTES=%s', async (takeNotes) => {
    const findAndCountAll = jest.fn().mockResolvedValue({ rows: [], count: 0 });
    getModels.mockReturnValue({ Request: { findAndCountAll }, Rating: {}, Term: {}, Status: {}, Employee: {} });

    await requestService.listRequests({ TAKE_NOTES: takeNotes });

    const conditions = findAndCountAll.mock.calls[0][0].where[Op.and];
    const notesCondition = conditions[1];
    expect(notesCondition.logic).toEqual(takeNotes === 'Yes' ? { [Op.ne]: '' } : { [Op.eq]: '' });
    expect(JSON.stringify(notesCondition.attribute)).toContain('BDS_NOTES');
  });
});
