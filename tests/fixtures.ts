import {test as base,expect} from '@playwright/test';
// 기능 검사는 앱과 무관한 외부 글꼴 CDN의 응답을 기다리지 않는다.
export const test=base.extend({page:async({page},use)=> {
 await page.route('https://fonts.googleapis.com/**',route=>route.abort());
 await page.route('https://fonts.gstatic.com/**',route=>route.abort());
 await use(page);
}});
export {expect};
