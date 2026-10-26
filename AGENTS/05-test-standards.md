# Test Standards

Framework: **Vitest** + **Angular Testing Utilities**
Location: same folder as the implementation file, `*.spec.ts`
Runner: `npx nx test <project-name>`

---

## When to Write Tests

- After writing **any new service method** → write a corresponding spec
- After writing **any component with business logic** → write a spec
- After **fixing a bug** → write a regression test that would have caught it
- Do NOT write tests for trivial getters or pass-through methods

---

## Service Test Template

```typescript
import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { DocumentDetailService } from './document-detail.service';

describe('DocumentDetailService', () => {
  let service: DocumentDetailService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
    });
    service = TestBed.inject(DocumentDetailService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify()); // ensures no unexpected requests

  it('should fetch document by uid', () => {
    const mockDoc = { uid: 'abc-123', title: 'Test Doc' };

    service.getFullDocument('abc-123').subscribe((doc) => {
      expect(doc.uid).toBe('abc-123');
    });

    const req = httpMock.expectOne((r) => r.url.includes('/id/abc-123'));
    expect(req.request.method).toBe('GET');
    req.flush(mockDoc);
  });

  it('should handle 404 error gracefully', () => {
    service.getFullDocument('bad-uid').subscribe({
      next: () => fail('should have errored'),
      error: (err) => expect(err.status).toBe(404),
    });

    httpMock
      .expectOne((r) => r.url.includes('/id/bad-uid'))
      .flush('Not found', { status: 404, statusText: 'Not Found' });
  });

  it('should call the correct automation endpoint for createCollection', () => {
    service.createCollection('My Collection', 'desc').subscribe();

    const req = httpMock.expectOne((r) => r.url.includes('/automation/Collection.Create'));
    expect(req.request.method).toBe('POST');
    expect(req.request.body.params.name).toBe('My Collection');
    req.flush({ uid: 'col-1', title: 'My Collection' });
  });
});
```

---

## Component Test Template — Test Signal State, Not DOM

```typescript
import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { MyFeatureComponent } from './my-feature';
import { DocumentDetailService } from '@nuxeo/satori-platform/nuxeo-client';

describe('MyFeatureComponent', () => {
  let component: MyFeatureComponent;
  let mockService: { getItems: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    mockService = {
      getItems: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [MyFeatureComponent],
      providers: [{ provide: DocumentDetailService, useValue: mockService }],
    }).compileComponents();

    const fixture = TestBed.createComponent(MyFeatureComponent);
    component = fixture.componentInstance;
  });

  it('should set loading to false and populate items after successful fetch', fakeAsync(() => {
    const mockItems = [{ id: '1', title: 'Doc 1' }];
    mockService.getItems.mockReturnValue(of(mockItems));

    component.loadItems();
    expect(component.loading()).toBe(true);

    tick();

    expect(component.loading()).toBe(false);
    expect(component.items().length).toBe(1);
    expect(component.error()).toBeNull();
  }));

  it('should set error signal and reset loading on failure', fakeAsync(() => {
    mockService.getItems.mockReturnValue(throwError(() => new Error('Network error')));

    component.loadItems();
    tick();

    expect(component.loading()).toBe(false);
    expect(component.error()).toBeTruthy();
    expect(component.items().length).toBe(0);
  }));
});
```

---

## What to Cover

For every new service method:

- Happy path (successful response)
- Error path (4xx / 5xx)
- Correct URL and HTTP method
- Correct request body (for POST/PUT)

For every component with state:

- Loading state is set correctly
- Error state is set correctly and loading is reset
- State is reset when input changes (for route-bound components)
- Memory cleanup: blob URLs revoked, subscriptions unsubscribed

---

## Coverage Requirements

Aim for:

- 80%+ line coverage on `libs/shared/nuxeo-client/src/lib/services/`
- 60%+ line coverage on feature components with business logic
- 100% coverage on utility functions

---

## Running Tests

```bash
# Run tests for affected projects only (CI mode)
npx nx affected -t test

# Run tests for a specific project
npx nx test nuxeo-client

# Run with coverage report
npx nx test nuxeo-client --coverage

# Watch mode (development)
npx nx test nuxeo-client --watch
```
