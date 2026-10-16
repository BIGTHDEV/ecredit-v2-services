/* eslint-env jest */

jest.mock('../config/env', () => ({
  environment: 'dev',
  powerPlatformUrl: 'https://example.powerplatform.com/flow?sig=test-signature',
}));

const config = require('../config/env');
const { suggestCompanyInfo } = require('./powerPlatformCompanyInfoService');

const validSuggestions = {
  fields: {
    registeredDate: { value: '2001-02-03', evidence: 'Official company registry record.' },
    registeredCapitalAmount: { value: '2500000', evidence: 'Registered capital in the record.' },
    customerTypeExternal: { value: 'Limited company', evidence: 'Company registration record.' },
    officialSignatory: { value: 'Jane Doe, director', evidence: 'Authorized signatory listing.' },
    majorShareholders: { value: 'Jane Doe (60%), John Doe (40%)', evidence: 'Shareholder listing.' },
  },
  sources: [{
    title: 'Department of Business Development',
    url: 'https://datawarehouse.dbd.go.th/company',
  }],
};

describe('powerPlatformCompanyInfoService', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    config.environment = 'dev';
    config.powerPlatformUrl = 'https://example.powerplatform.com/flow?sig=test-signature';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => validSuggestions,
    });
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('rejects Tax IDs that are not exactly 13 digits without calling the flow', async () => {
    await expect(suggestCompanyInfo('123456789012')).rejects.toMatchObject({
      statusCode: 400,
      code: 'INVALID_TAX_ID',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends the Tax ID in the flow prompt and returns validated suggestions', async () => {
    const userContext = {
      userEmail: 'nuttapongc@bigth.com',
      userName: 'NUC-NUTTAPONGC',
    };
    const onRequestPayload = jest.fn();
    const result = await suggestCompanyInfo('1234567890123', { ...userContext, onRequestPayload });

    expect(result.fields.registeredCapitalAmount.value).toBe('2500000');
    expect(result.fields.registeredDate.value).toBe('2001-02-03');
    expect(result.sources).toEqual(validSuggestions.sources);
    expect(global.fetch).toHaveBeenCalledWith(
      config.powerPlatformUrl,
      expect.objectContaining({ method: 'POST' }),
    );
    const request = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(request).toEqual({
      Prompt: expect.stringContaining('1234567890123'),
      userEmail: userContext.userEmail,
      userName: userContext.userName,
      Application: 'eCredit',
      Module: 'Main',
      Remark: 'DEV|Company information lookup by Tax ID',
    });
    expect(request.Prompt).toContain('"majorShareholders"');
    expect(request.Prompt).toContain('1. ใช้เลข 1234567890123 เป็นคำค้นหลักในการค้นหาบริษัท');
    expect(request.Prompt).toContain('สำหรับแหล่งข้อมูลอื่น ไม่จำเป็นต้องพบเลข 1234567890123 อยู่ในหน้าเดียวกับข้อมูลทุก field');
    expect(request.Prompt).toContain('ห้ามใช้ข้อมูลของบริษัทอื่นที่มีชื่อคล้ายกัน');
    expect(request.Prompt).toContain('ต้องมีอย่างน้อย 1 แหล่ง โดยแต่ละรายการต้องมี title และ URL แบบ HTTPS');
    expect(request.Prompt).toContain('ทุก value และ evidence ต้องเป็นข้อความ (string) หรือ null เท่านั้น');
    expect(request.Prompt).toContain('แสดงบุคคลแต่ละรายคนละบรรทัด');
    expect(request.Prompt).toContain('แสดงผู้ถือหุ้นแต่ละรายคนละบรรทัด');
    expect(request.Prompt).toContain('ให้ encode newline เป็น \\n ภายใน JSON string');
    expect(onRequestPayload).toHaveBeenCalledWith(request);
  });

  it('preserves newlines in official signatories and major shareholders', async () => {
    const multilineSuggestions = {
      ...validSuggestions,
      fields: {
        ...validSuggestions.fields,
        officialSignatory: {
          value: 'Jane Doe — Director\nJohn Doe — Director',
          evidence: 'Authorized signatory listing.',
        },
        majorShareholders: {
          value: 'Jane Doe — 60%\nJohn Doe — 40%',
          evidence: 'Shareholder listing.',
        },
      },
    };
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => multilineSuggestions,
    });

    const result = await suggestCompanyInfo('1234567890123', {
      userEmail: 'actor@example.com',
      userName: 'ACTOR',
    });

    expect(result.fields.officialSignatory.value).toContain('\n');
    expect(result.fields.majorShareholders.value).toContain('\n');
  });

  it('allows 120 seconds for the Power Platform response', async () => {
    const timeoutSpy = jest.spyOn(AbortSignal, 'timeout');
    try {
      await suggestCompanyInfo('1234567890123', {
        userEmail: 'actor@example.com',
        userName: 'ACTOR',
      });

      expect(timeoutSpy).toHaveBeenCalledWith(120_000);
    } finally {
      timeoutSpy.mockRestore();
    }
  });

  it('requires a complete authenticated user identity', async () => {
    await expect(suggestCompanyInfo('1234567890123')).rejects.toMatchObject({
      statusCode: 403,
      code: 'USER_IDENTITY_REQUIRED',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('fails explicitly when the Power Platform URL is not configured', async () => {
    config.powerPlatformUrl = '';

    await expect(suggestCompanyInfo('1234567890123', {
      userEmail: 'actor@example.com',
      userName: 'ACTOR',
    })).rejects.toMatchObject({
      statusCode: 503,
      code: 'POWERPLATFORM_NOT_CONFIGURED',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('accepts a JSON string response from the flow', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => JSON.stringify(validSuggestions),
    });

    await expect(suggestCompanyInfo('1234567890123', {
      userEmail: 'actor@example.com',
      userName: 'ACTOR',
    })).resolves.toMatchObject({
      fields: { customerTypeExternal: { value: 'Limited company' } },
    });
  });

  it('parses the Power Platform envelope where the JSON is returned in text', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        '@odata.type': '#Microsoft.Dynamics.CRM.expando',
        modelType: 'reasoning',
        text: JSON.stringify(validSuggestions),
        finishReason: 'stop',
        totalTokens: 1813,
      }),
    });

    await expect(suggestCompanyInfo('1234567890123', {
      userEmail: 'actor@example.com',
      userName: 'ACTOR',
    })).resolves.toMatchObject({
      fields: { registeredDate: { value: '2001-02-03' } },
      sources: validSuggestions.sources,
    });
  });

  it('accepts the updated response with nullable fields and multiple sources', async () => {
    const updatedResponse = {
      fields: {
        registeredDate: {
          value: '2016-02-18',
          evidence: 'แหล่งข้อมูลระบุเลขทะเบียนนิติบุคคล 0107559000044 ตรงกับ บริษัท โกลบอลกรีนเคมิคอล จำกัด (มหาชน) และระบุวันที่จดทะเบียน 18 กุมภาพันธ์ 2559',
        },
        registeredCapitalAmount: {
          value: '8189333600',
          evidence: 'แหล่งข้อมูลระบุเลขทะเบียนนิติบุคคล 0107559000044 ตรงกับ บริษัท โกลบอลกรีนเคมิคอล จำกัด (มหาชน) และระบุทุนจดทะเบียน 8,189,333,600 บาท',
        },
        customerTypeExternal: {
          value: 'บริษัทมหาชนจำกัด; ผู้ผลิตและจำหน่ายไบโอดีเซลและผลิตภัณฑ์โอลีโอเคมิคอล',
          evidence: 'ข้อมูลของบริษัทที่ใช้เลขทะเบียน 0107559000044 ระบุประเภทนิติบุคคลเป็นบริษัทจำกัด (มหาชน) และระบุธุรกิจว่าผลิตและจำหน่ายไบโอดีเซล รวมถึงผลิต จำหน่าย และขนส่งผลิตภัณฑ์โอลีโอเคมิคอล',
        },
        officialSignatory: { value: null, evidence: null },
        majorShareholders: { value: null, evidence: null },
      },
      sources: [
        {
          title: 'DBD DataWarehouse+ ผลการค้นหาเลขทะเบียนนิติบุคคล 0107559000044',
          url: 'https://datawarehouse.dbd.go.th/juristic/searchInfo?keyword=0107559000044',
        },
        {
          title: 'ข้อมูล บริษัท โกลบอลกรีนเคมิคอล จำกัด (มหาชน) ทะเบียน 0107559000044',
          url: 'https://www.dataforthai.com/company/0107559000044/',
        },
      ],
    };
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => updatedResponse,
    });

    const result = await suggestCompanyInfo('0107559000044', {
      userEmail: 'actor@example.com',
      userName: 'ACTOR',
    });

    expect(result).toEqual(updatedResponse);
  });

  it('rejects invalid capital amounts and impossible dates', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...validSuggestions,
        fields: {
          ...validSuggestions.fields,
          registeredCapitalAmount: { value: '2.5 million', evidence: 'Registry.' },
        },
      }),
    });
    await expect(suggestCompanyInfo('1234567890123', {
      userEmail: 'actor@example.com',
      userName: 'ACTOR',
    })).rejects.toMatchObject({
      code: 'POWERPLATFORM_INVALID_RESPONSE',
    });

    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        ...validSuggestions,
        fields: {
          ...validSuggestions.fields,
          registeredDate: { value: '2025-02-31', evidence: 'Registry.' },
        },
      }),
    });
    await expect(suggestCompanyInfo('1234567890123', {
      userEmail: 'actor@example.com',
      userName: 'ACTOR',
    })).rejects.toMatchObject({
      code: 'POWERPLATFORM_INVALID_RESPONSE',
    });
  });

  it('rejects responses without valid source URLs', async () => {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ ...validSuggestions, sources: [{ title: 'Fake', url: 'javascript:alert(1)' }] }),
    });

    await expect(suggestCompanyInfo('1234567890123', {
      userEmail: 'actor@example.com',
      userName: 'ACTOR',
    })).rejects.toMatchObject({
      statusCode: 502,
      code: 'POWERPLATFORM_NO_SOURCES',
      message: expect.stringContaining('at least one source actually used'),
    });
  });
});
