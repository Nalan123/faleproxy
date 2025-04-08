const axios = require('axios');
const cheerio = require('cheerio');
const express = require('express');
const path = require('path');
const request = require('supertest');
const { sampleHtmlWithYale } = require('./test-utils');
const nock = require('nock');

// Create a test express app for integration testing
const testApp = express();
testApp.use(express.json());
testApp.use(express.urlencoded({ extended: true }));

// Mock the app's endpoint for testing
testApp.post('/fetch', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // For test purposes, we use axios to fetch the URL
    // The actual HTTP request is intercepted by nock
    const response = await axios.get(url);
    const html = response.data;
    
    // Use cheerio to parse HTML and selectively replace text content, not URLs
    const $ = cheerio.load(html);
    
    // Process text nodes in the body
    $('body *').contents().filter(function() {
      return this.nodeType === 3; // Text nodes only
    }).each(function() {
      // Replace text content but not in URLs or attributes
      const text = $(this).text();
      
      // Improved replacement logic with word boundaries and case preservation
      const newText = text.replace(/\bYale\b/g, 'Fale')
                         .replace(/\byale\b/g, 'fale')
                         .replace(/\bYALE\b/g, 'FALE');
      
      if (text !== newText) {
        $(this).replaceWith(newText);
      }
    });
    
    // Process title separately
    const title = $('title').text();
    const newTitle = title.replace(/\bYale\b/g, 'Fale')
                         .replace(/\byale\b/g, 'fale')
                         .replace(/\bYALE\b/g, 'FALE');
    $('title').text(newTitle);
    
    return res.json({ 
      success: true, 
      content: $.html(),
      title: newTitle,
      originalUrl: url
    });
  } catch (error) {
    console.error('Error fetching URL:', error.message);
    return res.status(500).json({ 
      error: `Failed to fetch content: ${error.message}` 
    });
  }
});

describe('Integration Tests', () => {
  beforeAll(() => {
    // Disable real HTTP requests during testing
    nock.disableNetConnect();
    // Allow localhost connections for supertest
    nock.enableNetConnect('127.0.0.1');
  });

  afterAll(() => {
    nock.cleanAll();
    nock.enableNetConnect();
  });

  beforeEach(() => {
    // Reset nock before each test
    nock.cleanAll();
  });

  test('Should replace Yale with Fale in fetched content', async () => {
    // Mock the external URL
    const exampleDomain = 'https://example.com';
    nock(exampleDomain)
      .get('/')
      .reply(200, sampleHtmlWithYale);

    // Use supertest to test the endpoint
    const response = await request(testApp)
      .post('/fetch')
      .send({ url: exampleDomain });

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    
    // Verify Yale has been replaced with Fale in text
    const $ = cheerio.load(response.body.content);
    expect($('title').text()).toBe('Fale University Test Page');
    expect($('h1').text()).toBe('Welcome to Fale University');
    expect($('p').first().text()).toContain('Fale University is a private');
    
    // Verify URLs remain unchanged
    const links = $('a');
    let hasYaleUrl = false;
    links.each((i, link) => {
      const href = $(link).attr('href');
      if (href && href.includes('yale.edu')) {
        hasYaleUrl = true;
      }
    });
    expect(hasYaleUrl).toBe(true);
    
    // Verify link text is changed
    expect($('a').first().text()).toBe('About Fale');
  });

  test('Should handle invalid URLs', async () => {
    // Mock a failing URL
    nock('https://invalid-url.com')
      .get('/')
      .replyWithError('Connection refused');

    const response = await request(testApp)
      .post('/fetch')
      .send({ url: 'https://invalid-url.com/' });

    expect(response.status).toBe(500);
    expect(response.body.error).toContain('Failed to fetch content');
  });

  test('Should handle missing URL parameter', async () => {
    const response = await request(testApp)
      .post('/fetch')
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error).toBe('URL is required');
  });
});
