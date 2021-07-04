import { Component, OnInit } from '@angular/core';
import { SearchIndex, XivapiService } from '@xivapi/angular-client';
import { BehaviorSubject, combineLatest, Observable, of, Subject } from 'rxjs';
import { bufferCount, map, switchMap, takeUntil, tap } from 'rxjs/operators';
import { SpendingEntry } from '../spending-entry';
import { DataService } from '../../../core/api/data.service';
import { ItemData } from '../../../model/garland-tools/item-data';
import * as _ from 'lodash';
import { requestsWithDelay } from '../../../core/rxjs/requests-with-delay';
import { AuthFacade } from '../../../+state/auth.facade';
import { TeamcraftComponent } from '../../../core/component/teamcraft-component';
import { UniversalisService } from '../../../core/api/universalis.service';
import { LazyDataService } from '../../../core/data/lazy-data.service';
import { getItemSource } from '../../../modules/list/model/list-row';
import { DataType } from '../../../modules/list/data/data-type';

@Component({
  selector: 'app-currency-spending',
  templateUrl: './currency-spending.component.html',
  styleUrls: ['./currency-spending.component.less']
})
export class CurrencySpendingComponent extends TeamcraftComponent implements OnInit {

  public currencies$: Observable<number[]>;

  public currency$ = new Subject<number>();

  public results$: Observable<SpendingEntry[]>;

  public amount$: BehaviorSubject<number> = new BehaviorSubject<number>(null);

  public servers$: Observable<string[]>;

  public server$: Subject<string> = new Subject<string>();

  public loading = false;

  public tradesCount = 0;

  public loadedPrices = 0;

  constructor(private xivapi: XivapiService, private dataService: DataService,
              private authFacade: AuthFacade, private universalis: UniversalisService,
              private lazyData: LazyDataService) {
    super();
    this.servers$ = this.xivapi.getServerList().pipe(
      map(servers => {
        return servers.sort();
      })
    );

    this.currencies$ = this.xivapi.search({
      indexes: [SearchIndex.ITEM],
      filters: [
        {
          column: 'IconID',
          operator: '>=',
          value: 65000
        },
        {
          column: 'IconID',
          operator: '<',
          value: 66000
        }
      ]
    }).pipe(
      map(res => {
        return [
          ...res.Results.filter(item => {
            // Remove gil, venture and outdated tomes/scrips
            return [1, 23, 24, 26, 30, 31, 32, 33, 34, 35, 10308, 10309, 10310, 10311, 21072].indexOf(item.ID) === -1;
          }).map(item => item.ID as number),
          33870
        ];
      })
    );

    this.results$ = combineLatest([this.currency$, this.server$]).pipe(
      switchMap(([currency, server]) => {
        this.loading = true;
        return this.dataService.getItem(currency).pipe(
          map((item: ItemData) => {
            let entries = item.item.tradeCurrency.filter(entry => entry.npcs.length > 0);

            if (entries.length === 0 && item.item.tradeCurrency.length > 0) {
              entries = item.item.tradeCurrency;
            }

            return [].concat.apply([], entries.map(entry => {
              return entry.listings.map(listing => {
                const currencyEntry = listing.currency.find(c => +c.id === currency);
                return {
                  npcs: entry.npcs,
                  item: +listing.item[0].id,
                  HQ: listing.item[0].hq === 1,
                  rate: listing.item[0].amount / currencyEntry.amount
                };
              });
            }));
          }),
          switchMap(entries => {
            const batches = _.chunk(entries, 100)
              .map((chunk: any) => {
                return this.universalis.getServerPrices(
                  server,
                  ...chunk.map(entry => entry.item)
                );
              });
            this.tradesCount = entries.length;
            return requestsWithDelay(batches, 250, true).pipe(
              tap(res => {
                this.loadedPrices = Math.min(this.tradesCount, this.loadedPrices + res.length);
              }),
              bufferCount(batches.length),
              map(res => {
                return [].concat.apply([], res)
                  .filter(mbRow => {
                    return mbRow.History && mbRow.History.length > 0 || mbRow.Prices && mbRow.Prices.length > 0;
                  });
              }),
              map((res) => {
                return entries
                  .filter(entry => {
                    return res.some(r => r.ItemId === entry.item);
                  })
                  .map(entry => {
                    const mbRow = res.find(r => r.ItemId === entry.item);
                    let prices = (mbRow.Prices || [])
                      .filter(item => item.IsHQ === (entry.HQ || false));
                    if (prices.length === 0) {
                      prices = (mbRow.History || [])
                        .filter(item => item.IsHQ === (entry.HQ || false));
                    }
                    const price = prices
                      .sort((a, b) => a.PricePerUnit - b.PricePerUnit)[0];
                    return <SpendingEntry>{
                      ...entry,
                      npcs: getItemSource(this.lazyData.getExtract(entry.item), DataType.TRADE_SOURCES)
                        .filter(trade => trade.trades.some(t => t.currencies.some(c => c.id === currency)))
                        .map(tradeSource => tradeSource.npcs.filter(npc => !npc.festival).map(npc => npc.id)),
                      price: price && price.PricePerUnit
                    };
                  })
                  .filter(entry => entry.price)
                  .sort((a, b) => {
                    return (b.price / b.rate) - (a.price / a.rate);
                  });
              })
            );
          })
        );
      }),
      tap(() => {
        this.loading = false;
        this.tradesCount = 0;
      })
    );
  }

  ngOnInit(): void {
    this.authFacade.loggedIn$.pipe(
      switchMap(loggedIn => {
        if (loggedIn) {
          return this.authFacade.mainCharacter$.pipe(
            map(character => character.Server)
          );
        } else {
          return of(null);
        }
      }),
      takeUntil(this.onDestroy$)
    ).subscribe(server => {
      if (server !== null) {
        this.server$.next(server);
      }
    });
  }

}
