/*
 * ملف: /netlify/functions/getChatReply.js
 * نسخة قوية جداً (Zero-Dependency) تستخدم مكتبة https الأصلية المدمجة في Node.js
 * هذه النسخة تعمل على أي إصدار ولا تحتاج لملف package.json
 */

const https = require('https');

exports.handler = async (event) => {
    // 1. إعدادات CORS (للسماح للموقع بالاتصال)
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json; charset=utf-8'
    };

    // التعامل مع طلبات الفحص المسبق
    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    // التأكد من أن الطلب هو POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method Not Allowed' }) };
    }

    try {
        // 2. التحقق من مفتاح API
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return { 
                statusCode: 200, 
                headers, 
                body: JSON.stringify({ text: "⚠️ خطأ: مفتاح GEMINI_API_KEY غير موجود في إعدادات Netlify." }) 
            };
        }

        // 3. قراءة البيانات المرسلة
        let body;
        try {
            body = JSON.parse(event.body || '{}');
        } catch (e) {
            return { statusCode: 200, headers, body: JSON.stringify({ text: "⚠️ خطأ: البيانات المرسلة تالفة." }) };
        }

        const { history = [], clientInfo = {}, isFirstRun = false } = body;

        // 4. تجهيز التعليمات (Prompt)
        const systemPrompt = `
            أنت "مساعد ض" (Daad Assistant)، المستشار الذكي لشركة "ضاد".
            مهمتك: تحليل مشروع العميل واقتراح خطط تسويقية.
            
            بيانات العميل:
            - المشروع: ${clientInfo.name || 'غير محدد'}
            - النشاط: ${clientInfo.businessType || '-'}
            - الهدف: ${clientInfo.strategyGoal || '-'}
            - الميزانية: ${clientInfo.budgetRange || '-'}
            - الرابط: ${clientInfo.link || '-'}
            - المنافسين: ${clientInfo.competitors || '-'}
            
            تحدث بلهجة سعودية مهنية ومختصرة.
            ${isFirstRun ? "ابدأ بترحيب حار وتحليل أولي سريع." : ""}
        `;

        // دمج الرسائل
        let contents = [{ role: "user", parts: [{ text: systemPrompt }] }];
        
        if (!isFirstRun && history.length > 0) {
            // إضافة آخر رسالتين فقط لتخفيف الحمل
            const recent = history.slice(-4).map(msg => ({
                role: msg.role === 'user' ? 'user' : 'model',
                parts: [{ text: msg.parts[0].text }]
            }));
            contents = contents.concat(recent);
        }

        // 5. إعداد بيانات الطلب لجوجل
        const requestData = JSON.stringify({
            contents: contents,
            generationConfig: { temperature: 0.7 }
        });

        const options = {
            hostname: 'generativelanguage.googleapis.com',
            path: `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(requestData)
            }
        };

        // 6. تنفيذ الاتصال باستخدام https (بدلاً من fetch لتجنب المشاكل)
        return new Promise((resolve, reject) => {
            const req = https.request(options, (res) => {
                let responseBody = '';

                res.on('data', (chunk) => {
                    responseBody += chunk;
                });

                res.on('end', () => {
                    try {
                        const jsonResponse = JSON.parse(responseBody);

                        if (res.statusCode !== 200) {
                            // في حالة وجود خطأ من جوجل
                            const errorMsg = jsonResponse.error?.message || 'Unknown Error';
                            resolve({
                                statusCode: 200, // نرجع 200 لنعرض الخطأ في الشات
                                headers,
                                body: JSON.stringify({ text: `⚠️ خطأ من جوجل: ${errorMsg}` })
                            });
                        } else {
                            // نجاح العملية
                            const replyText = jsonResponse.candidates?.[0]?.content?.parts?.[0]?.text;
                            resolve({
                                statusCode: 200,
                                headers,
                                body: JSON.stringify({ text: replyText || "عذراً، لم يصل رد مفهوم." })
                            });
                        }
                    } catch (e) {
                        resolve({
                            statusCode: 200,
                            headers,
                            body: JSON.stringify({ text: `⚠️ خطأ في معالجة الرد: ${e.message}` })
                        });
                    }
                });
            });

            req.on('error', (e) => {
                resolve({
                    statusCode: 200,
                    headers,
                    body: JSON.stringify({ text: `⚠️ خطأ في الاتصال بالسيرفر: ${e.message}` })
                });
            });

            // إرسال البيانات
            req.write(requestData);
            req.end();
        });

    } catch (globalError) {
        // التقاط أي انهيار غير متوقع في الكود
        console.error("CRITICAL ERROR:", globalError);
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ text: `⚠️ انهيار النظام: ${globalError.message}` })
        };
    }
};